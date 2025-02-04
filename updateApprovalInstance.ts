import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { load } from "https://deno.land/std@0.218.0/dotenv/mod.ts";

// 加载环境变量
const env = await load();
const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const LARK_API_BASE = "https://open.feishu.cn/open-apis/approval/v4";
const LARK_API_TENANT_ACCESS_TOKEN = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BATCH_UPDATE_COUNT = 5;// 每次处理50条


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

async function getApprovalInstanceDetail(instanceCode: string, tenant_access_token: string): Promise<any> {
  const response = await fetch(
    `${LARK_API_BASE}/instances/${instanceCode}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${tenant_access_token}`,
        "Content-Type": "application/json"
      }
  });
  //console.log("response:", response);
  if (!response.ok) {
    throw new Error(`获取实例详情失败: ${response.status}`);
  }

  const result = await response.json();
  
  if (result.code !== 0) {
    throw new Error(`API调用失败: ${result.msg}`);
  }
  //console.log("result:", result.data);
  return result.data;
}

export async function updateApprovalInstances(): Promise<Response> {
  console.log("开始更新审批实例...");
  const tenant_access_token = await getTenantAccessToken();

  // 获取需要更新的审批实例（状态为 PENDING 或 null）
  const { data: instances, error: queryError } = await supabase
    .from("approval_instances")
    .select("instance_code")
    .or("status.is.null,status.eq.PENDING")
    .order("last_updated", { ascending: true, nullsFirst: true })  // 未更新的记录在前，然后是最早更新的记录
    .limit(BATCH_UPDATE_COUNT);

  if (queryError) {
    console.error("查询待更新实例失败:", queryError);
    return new Response(JSON.stringify({ error: "查询待更新实例失败" }), { status: 500 });
  }

  if (!instances || instances.length === 0) {
    console.log("无需要更新的审批实例");
    return new Response(JSON.stringify({ message: "无需要更新的审批实例" }), { status: 200 });
  }

  console.log(`找到 ${instances.length} 个待更新实例`);
  let updatedCount = 0;

  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    try {
      console.log(`[${i + 1}/${instances.length}] 开始获取实例 ${instance.instance_code} 详情`);
      const instanceDetail = await getApprovalInstanceDetail(instance.instance_code, tenant_access_token);
      
      // 更新数据库中的实例信息
      const { error: updateError } = await supabase
        .from("approval_instances")
        .update({
          department_id: instanceDetail.department_id,
          end_time: instanceDetail.end_time ? new Date(parseInt(instanceDetail.end_time)) : null,
          form: JSON.parse(instanceDetail.form),
          open_id: instanceDetail.open_id,
          reverted: instanceDetail.reverted,
          serial_number: instanceDetail.serial_number,
          start_time: new Date(parseInt(instanceDetail.start_time)),
          status: instanceDetail.status,
          task_list: instanceDetail.task_list,
          timeline: instanceDetail.timeline,
          user_id: instanceDetail.user_id,
          uuid: instanceDetail.uuid,
          last_updated: new Date(Date.now())
        })
        .eq("instance_code", instance.instance_code);

      if (updateError) {
        console.error(`[${i + 1}/${instances.length}] 更新实例 ${instance.instance_code} 失败:`, updateError);
      } else {
        console.log(`[${i + 1}/${instances.length}] 实例 ${instance.instance_code} 更新成功`);
        updatedCount++;
      }

    } catch (error) {
      console.error(`[${i + 1}/${instances.length}] 处理实例 ${instance.instance_code} 时出错:`, error);
    }
  }

  return new Response(
    JSON.stringify({ message: `更新完成，成功更新 ${updatedCount} 个审批实例` }), 
    { status: 200 }
  );
}

await updateApprovalInstances();
//await getApprovalInstanceDetail("007DB54A-CB02-4C55-BA5D-94789CB851EC", await getTenantAccessToken());