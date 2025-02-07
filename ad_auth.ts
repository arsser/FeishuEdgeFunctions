// 启用 npm 兼容性
import ldap from "npm:ldapjs";

// Active Directory 服务器配置
const LDAP_SERVER = "ldap://10.40.30.49"; // 或者 "ldaps://your-ad-server.com:636" 用于加密
const BASE_DN = "OU=Yitu Users,DC=yitu-inc,DC=intra"; // 例如 DC=company,DC=local
//const LDAP_BASE = "OU=Yitu Users,DC=yitu-inc,DC=intra";

async function authenticate(username: string, password: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const client = ldap.createClient({ url: LDAP_SERVER });

        const userDn = `CN=${username},OU=Users,${BASE_DN}`; // 需要根据实际 AD 结构修改

        client.bind(userDn, password, (err) => {
            if (err) {
                console.error("Authentication failed:", err.message);
                resolve(false);
            } else {
                console.log("Authentication successful!");
                resolve(true);
            }
            client.unbind();
        });
    });
}

// 测试用户
const username = "qian.wu@yitu-inc.intra";
const password = "";

authenticate(username, password).then((isAuthenticated) => {
    console.log(`Login status: ${isAuthenticated ? "Success" : "Failed"}`);
});
