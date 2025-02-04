import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { load } from "https://deno.land/std@0.218.0/dotenv/mod.ts";

// 加载环境变量
const env = await load();
const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const LARK_API_BASE = "https://open.feishu.cn/open-apis/approval/v4";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 验证飞书回调请求
function verifyRequest(request: Request): boolean {
  // TODO: 添加请求验证逻辑
  return true;
}

// 处理审批状态变更
async function handleApprovalChange(instanceCode: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("approval_instances")
    .update({
      status: status,
      last_updated: new Date(Date.now())
    })
    .eq("instance_code", instanceCode);

  if (error) {
    throw new Error(`更新审批实例状态失败: ${error.message}`);
  }
}

export async function handleWebhook(request: Request): Promise<Response> {
  console.log("收到审批回调请求");

  // 验证请求
  if (!verifyRequest(request)) {
    return new Response(JSON.stringify({ error: "Invalid request" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // 解析请求体
    const body = await request.json();
    console.log("回调请求内容:", body);

    // 处理不同类型的事件
    const eventType = body.header?.event_type;
    if (!eventType) {
      throw new Error("Missing event type");
    }

    switch (eventType) {
      case "approval.instance.status_change": {
        const instanceCode = body.event?.instance_code;
        const status = body.event?.status;
        
        if (!instanceCode || !status) {
          throw new Error("Missing required fields");
        }

        await handleApprovalChange(instanceCode, status);
        console.log(`审批实例 ${instanceCode} 状态更新为 ${status}`);
        break;
      }
      
      default:
        console.log(`未处理的事件类型: ${eventType}`);
    }

    // 返回成功响应
    return new Response(JSON.stringify({ 
      challenge: body.challenge 
    }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("处理回调请求失败:", error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// 测试代码
const testEvent = {
  "schema": "2.0",
  "header": {
    "event_id": "5e3702a6-1554-46fc-a003-b2d1e7d4dc63",
    "event_type": "approval.instance.status_change",
    "create_time": "1704872131000",
    "token": "rQVuDEVcst4LPzwsLvnc8bYYkNxWaXwz",
    "app_id": "cli_a4536c8783f8d00c",
    "tenant_key": "736588c9260f175e"
  },
  "event": {
    "instance_code": "007DB54A-CB02-4C55-BA5D-94789CB851EC",
    "status": "APPROVED"
  }
};

// await handleWebhook(new Request("http://localhost", {
//   method: "POST",
//   headers: { "Content-Type": "application/json" },
//   body: JSON.stringify(testEvent)
// })); 