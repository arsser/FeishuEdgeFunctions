import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { load } from "https://deno.land/std@0.218.0/dotenv/mod.ts";

// 加载环境变量
const env = await load();

// 添加调试日志
console.log("Loading environment variables...");
console.log("SUPABASE_URL:", env["SUPABASE_URL"]);
console.log("SUPABASE_KEY:", env["SUPABASE_SERVICE_ROLE_KEY"]);

const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const LARK_API_INSTANCES = "https://open.feishu.cn/open-apis/approval/v4/instances";
const LARK_API_TENANT_ACCESS_TOKEN = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const FIRST_TIME_SYNC_TIME = '2024-01-01 00:00:00';
const PAGE_SIZE = 100;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  return url.toString();
}

// 获取 tenant_access_token 的函数
async function getTenantAccessToken(): Promise<string> {
  const response = await fetch(LARK_API_TENANT_ACCESS_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      "app_id": env.LARK_APP_ID,
      "app_secret": env.LARK_APP_SECRET
    })
  });

  const result = await response.json();
  
  if (!result.tenant_access_token) {
    throw new Error(`Failed to get tenant_access_token: ${JSON.stringify(result)}`);
  }

  return result.tenant_access_token;
}

// 添加批量处理函数
async function checkExistingInstances(
  instanceCodes: string[],
  batchSize = 100
): Promise<Set<string>> {
  const existingCodes = new Set<string>();
  
  // 将实例代码分成多个批次
  for (let i = 0; i < instanceCodes.length; i += batchSize) {
    const batch = instanceCodes.slice(i, i + batchSize);
    console.log(`检查第 ${i/batchSize + 1} 批实例，数量: ${batch.length}`);

    const { data: existingInstances, error: queryError } = await supabase
      .from("lark_approval_instances")
      .select("instance_code")
      .in("instance_code", batch);

    if (queryError) {
      console.error(`查询第 ${i/batchSize + 1} 批实例失败:`, queryError);
      continue;
    }

    // 将已存在的实例代码添加到集合中
    existingInstances?.forEach(instance => existingCodes.add(instance.instance_code));
  }

  return existingCodes;
}

export async function getNewApprovalInstances(): Promise<Response> {
  console.log("开始同步审批实例...");
  const tenant_access_token = await getTenantAccessToken();

  // 获取启用同步的审批流
  const { data: approvals, error: approvalError } = await supabase
    .from("lark_approvals")
    .select("approval_code,name")
    .eq("enabled", true);

  if (approvalError) {
    console.error("查询审批流失败:", approvalError);
    return new Response(JSON.stringify({ error: "查询审批流失败" }), { status: 500 });
  }
  console.log("获取到approvals:", approvals);

  if (!approvals || approvals.length === 0) {
    console.log("无需要同步的审批流");
    return new Response(JSON.stringify({ message: "无需要同步的审批流" }), { status: 200 });
  }

  let newInstancesCount = 0;

  for (const approval of approvals) {
    const approvalCode = approval.approval_code;

    // 获取数据库中该审批流最后同步的时间
    const { data: lastInstance, error: lastInstanceError } = await supabase
      .from("lark_approval_instances")
      .select("start_time")
      .eq("approval_code", approvalCode)
      .order("start_time", { ascending: false })
      .limit(1)
      .single();



    if (lastInstanceError && lastInstanceError.code !== "PGRST116") {  // PGRST116 表示无记录
      console.error(`数据库查询审批流 ${approvalCode} 失败:`, lastInstanceError);
      continue;
    }
    console.log("lastInstance:", lastInstance);
    const startTime = lastInstance 
      ? new Date(lastInstance.start_time).getTime() 
      : new Date(FIRST_TIME_SYNC_TIME).getTime();

    let pageToken = "";
    let allInstances: Array<{ instance_code: string; approval_code: string }> = [];

    // 使用循环处理所有页面
    while (true) {
      // 构建 API URL，添加 page_token 参数
      const params: Record<string, string> = {
        page_size: PAGE_SIZE.toString(),
        approval_code: approvalCode,
        start_time: startTime.toString(),
        end_time: Date.now().toString()
      };
      
      if (pageToken) {
        params.page_token = pageToken;
      }
      
      const apiUrl = buildUrl(LARK_API_INSTANCES, params);

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${tenant_access_token}`,
          "Content-Type": "application/json"
        }
      });

      // 添加调试日志
      //console.log("API Response Status:", response.status);
      //console.log("API Response Headers:", Object.fromEntries(response.headers));
      const responseText = await response.text();
      //console.log("API Response Body:", responseText);


      // 检查响应状态码
      if (!response.ok) {
        console.error(`飞书 API 调用失败: ${response.status} ${response.statusText}`);
        console.error("错误响应:", responseText);
        break;
      }

      try {
        const result = JSON.parse(responseText);
        //console.log("解析后的响应:", result);
        
        if (result.code !== 0) {
          //console.error(`审批流 ${approvalCode} API调用失败:`, result.msg);
          break;
        }

        const instanceList = result.data?.instance_code_list;
        if (!instanceList || instanceList.length === 0) {
          console.log(`审批流 ${approvalCode} 当前页无审批实例`);
          break;
        }

        // 将当前页的实例添加到总列表中
        const currentInstances = instanceList.map((instanceCode: string) => ({
          instance_code: instanceCode,
          approval_code: approvalCode,
        }));
        
        allInstances = allInstances.concat(currentInstances);
        //console.log(`审批流 ${approvalCode} 当前页获取到 ${currentInstances.length} 个实例`);

        // 检查是否有更多数据
        if (!result.data.has_more || !result.data.page_token) {
          //console.log(`审批流 ${approvalCode} 已获取所有数据`);
          break;
        }


        // 更新 page_token 继续获取下一页
        pageToken = result.data.page_token;
        //console.log(`审批流 ${approvalCode} 继续获取下一页，page_token:`, pageToken);


      } catch (error) {
        console.error(`处理审批流 ${approvalCode} 时出错:`, error);
        break;
      }
    }

    // 所有页面处理完成后，将数据保存到数据库
    if (allInstances.length > 0) {
      console.log(`审批流 ${approvalCode} 获取到 ${allInstances.length} 个实例`);
      
      // 使用 upsert 并返回插入的记录
      const { data: insertedData, error } = await supabase
        .from("lark_approval_instances")
        .upsert(allInstances, { 
          onConflict: "instance_code",
          ignoreDuplicates: true,
          count: 'exact'  // 返回影响的行数
        }).select();

      if (error) {
        console.error(`审批流 ${approvalCode} 数据库更新失败`, error);
      } else {
        const affectedRows = insertedData?.length || 0;
        console.log(`审批流 ${approvalCode} 同步完成，新增 ${affectedRows} 个审批实例`);
        newInstancesCount += affectedRows;
      }
    } else {
      console.log(`审批流 ${approvalCode} 无新增审批实例`);
    }
  }
  return new Response(JSON.stringify({ message: `同步完成，新增 ${newInstancesCount} 个审批实例` }), { status: 200 });
}

await getNewApprovalInstances();