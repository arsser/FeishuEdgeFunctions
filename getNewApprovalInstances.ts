import { createClient } from "https://esm.sh/@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FEISHU_API_BASE = "https://open.feishu.cn/open-apis/approval/v4/instance/list";
const FEISHU_TOKEN = Deno.env.get("FEISHU_API_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function getNewApprovalInstances(): Promise<Response> {
  console.log("开始同步审批实例...");

  // 获取启用同步的审批流
  const { data: approvals, error: approvalError } = await supabase
    .from("approvals")
    .select("approval_code")
    .eq("enabled", true);

  if (approvalError) {
    console.error("查询审批流失败:", approvalError);
    return new Response(JSON.stringify({ error: "查询审批流失败" }), { status: 500 });
  }

  if (!approvals || approvals.length === 0) {
    console.log("无需要同步的审批流");
    return new Response(JSON.stringify({ message: "无需要同步的审批流" }), { status: 200 });
  }

  let newInstancesCount = 0;

  for (const approval of approvals) {
    const approvalCode = approval.approval_code;

    // 获取数据库中该审批流最后同步的时间
    const { data: lastInstance, error: lastInstanceError } = await supabase
      .from("approval_instances")
      .select("apply_time")
      .eq("approval_code", approvalCode)
      .order("apply_time", { ascending: false })
      .limit(1)
      .single();

    if (lastInstanceError && lastInstanceError.code !== "PGRST116") {  // PGRST116 表示无记录
      console.error(`查询审批流 ${approvalCode} 失败:`, lastInstanceError);
      continue;
    }

    const startTime = lastInstance ? new Date(lastInstance.apply_time).getTime() : Date.now() - 7 * 24 * 60 * 60 * 1000;

    // 调用飞书 API 获取实例 ID
    const response = await fetch(FEISHU_API_BASE, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FEISHU_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        approval_code: approvalCode,
        start_time: startTime,
        page_size: 50
      })
    });

    const result = await response.json();

    if (!result.data || !result.data.instance_list) {
      console.log(`审批流 ${approvalCode} 无新增审批实例`);
      continue;
    }

    // 处理返回的实例 ID
    const instances = result.data.instance_list.map((inst: any) => ({
      instance_code: inst.instance_code,
      approval_code: approvalCode,
      status: inst.status,
      apply_time: new Date(inst.start_time).toISOString()
    }));

    // 插入到数据库（防止重复插入）
    const { error } = await supabase
      .from("approval_instances")
      .upsert(instances, { onConflict: ["instance_code"] });

    if (error) {
      console.error(`审批流 ${approvalCode} 数据库更新失败`, error);
    } else {
      console.log(`审批流 ${approvalCode} 同步完成，新增 ${instances.length} 个审批实例`);
      newInstancesCount += instances.length;
    }
  }

  return new Response(JSON.stringify({ message: `同步完成，新增 ${newInstancesCount} 个审批实例` }), { status: 200 });
}
