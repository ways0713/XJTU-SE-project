let env = "develop"

// Avoid accidentally using develop config in release build.
const envVersion = wx.getAccountInfoSync().miniProgram.envVersion
if (envVersion === "release" && env !== "production") {
  env = "production"
}

export default {
  env,
  baseUrl: {
    // Prefer LAN IP for WeChat DevTools / real-device debugging.
    // If your IP changes, update this value.
    develop: "http://192.168.1.102:3000",
    production: "http://api.xxx.com",
  },
}
