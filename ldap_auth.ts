import { Client } from "npm:ldapjs";

// LDAP 服务器配置
const LDAP_URL = "ldap://10.40.30.49";
// 用户所在的基础 DN
const LDAP_BASE = "OU=Yitu Users,DC=yitu-inc,DC=intra";

/**
 * 直接验证用户凭据
 * 通过构造用户 DN，并直接使用用户提供的密码进行 bind 验证。
 * 如果绑定成功，则说明账号密码正确；否则返回错误。
 *
 * @param username - 用户名，对应于 LDAP 中 CN 的值
 * @param password - 用户密码
 */
async function authenticateUser(username: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 构造用户 DN，例如：CN=testuser,OU=Yitu Users,DC=yitu-inc,DC=intra
    const userDN = `CN=${username},${LDAP_BASE}`;
    const client = new Client({ url: LDAP_URL });

    client.bind(userDN, password, (err) => {
      // 无论成功或失败，解绑客户端
      client.unbind();
      if (err) {
        return reject("Invalid username or password");
      } else {
        return resolve();
      }
    });
  });
}

async function main() {
  if (Deno.args.length < 2) {
    console.error("Usage: deno run --allow-all ldap_auth.ts <username> <password>");
    Deno.exit(1);
  }

  const username = Deno.args[0];
  const password = Deno.args[1];

  try {
    await authenticateUser(username, password);
    console.log("Authentication successful");
  } catch (error) {
    console.error("Authentication failed:", error);
  }
}

main();
