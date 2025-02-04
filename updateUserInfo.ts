import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { load } from "https://deno.land/std@0.218.0/dotenv/mod.ts";

const env = await load();
const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const LARK_API_USER = "https://open.feishu.cn/open-apis/contact/v3/users/";
const LARK_API_TENANT_ACCESS_TOKEN = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BATCH_UPDATE_COUNT = 50;  // 每次处理50个用户

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

async function getUserInfo(userId: string, token: string): Promise<any> {
  const response = await fetch(
    `${LARK_API_USER}${userId}?user_id_type=user_id`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`获取用户信息失败: ${response.status}`);
  }

  const result = await response.json();
  //console.log("用户信息返回:", result);  // 添加调试日志
  
  if (result.code !== 0) {
    throw new Error(`API调用失败: ${result.msg}`);
  }

  return result.data.user;
}

// 添加用户信息比较函数
function isUserInfoChanged(oldInfo: any, newInfo: any): boolean {
  return oldInfo.name !== newInfo.name ||
         oldInfo.mobile !== newInfo.mobile ||
         oldInfo.description !== newInfo.description ||
         oldInfo.union_id !== newInfo.union_id ||
         oldInfo.open_id !== newInfo.open_id;
}

export async function updateUserInfo(): Promise<Response> {
  console.log("开始更新用户信息...");
  const token = await getTenantAccessToken();
  console.log("token:", token);
  // 获取需要更新的用户
  const { data: users, error: queryError } = await supabase
    .from("lark_users")
    .select("*")  // 获取所有字段以便比较
    .order("last_updated", { ascending: true, nullsFirst: true })
    .limit(BATCH_UPDATE_COUNT);

  if (queryError) {
    console.error("查询用户失败:", queryError);
    return new Response(JSON.stringify({ error: "查询用户失败" }), { status: 500 });
  }

  if (!users || users.length === 0) {
    console.log("无需要更新的用户");
    return new Response(JSON.stringify({ message: "无需要更新的用户" }), { status: 200 });
  }

  console.log(`找到 ${users.length} 个待更新用户`);
  let updatedCount = 0;

  for (let i = 0; i < users.length; i++) {
    try {
      const user = users[i];
      console.log(`[${i + 1}/${users.length}] 开始获取用户 ${user.user_id} 信息`);
      
      const userInfo = await getUserInfo(user.user_id, token);
      
      // 比较用户信息是否有变化
      if (!isUserInfoChanged(user, userInfo)) {
        console.log(`[${i + 1}/${users.length}] 用户 ${user.user_id} 信息无变化，跳过更新`);
        continue;
      }

      const { error: updateError } = await supabase
        .from("lark_users")
        .update({
          name: userInfo.name,
          mobile: userInfo.mobile,
          description: userInfo.description,
          union_id: userInfo.union_id,
          open_id: userInfo.open_id,
          last_updated: new Date(Date.now())
        })
        .eq("user_id", user.user_id);

      if (updateError) {
        console.error(`[${i + 1}/${users.length}] 更新用户 ${user.user_id} 失败:`, updateError);
      } else {
        console.log(`[${i + 1}/${users.length}] 用户 ${user.user_id} 更新成功`);
        updatedCount++;
      }

    } catch (error) {
      console.error(`处理用户信息时出错:`, error);
    }
  }
  console.log(`更新完成，成功更新 ${updatedCount} 个用户信息`);
  return new Response(
    JSON.stringify({ message: `更新完成，成功更新 ${updatedCount} 个用户信息` }), 
    { status: 200 }
  );

}

await updateUserInfo();
