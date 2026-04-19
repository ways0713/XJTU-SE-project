const app = getApp()
import { toLogin } from "./auth"

export default function createRequest(options = {}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync("token")
    if (options.needLogin !== false && !token) {
      wx.showToast({
        title: "请先登录",
        icon: "none",
      })
      setTimeout(() => {
        toLogin()
      }, 1500)
      reject(new Error("UNAUTHORIZED"))
      return
    }

    const baseUrl = app.getConfig("baseUrl")
    const url = `${baseUrl}${options.url}`
    const header = {
      token,
    }

    let showLoading = false
    if (options.loading !== false) {
      showLoading = true
      wx.showLoading({
        title: "正在加载",
        mask: true,
      })
    }

    wx.request({
      url,
      method: options.method || "GET",
      timeout: options.timeout || 20000,
      header,
      data: options.data || {},
      success(res) {
        const payload = res.data || {}
        switch (payload.code) {
          case 0:
            resolve(payload)
            return
          case -1:
            wx.showToast({
              title: payload.msg || "请求失败",
              icon: "none",
            })
            reject(new Error(payload.msg || "REQUEST_FAILED"))
            return
          case 401:
          case 403:
            wx.showToast({
              title: "登录已失效，请重新登录",
              icon: "none",
            })
            setTimeout(() => {
              toLogin()
            }, 1000)
            reject(new Error("AUTH_EXPIRED"))
            return
          default:
            wx.showToast({
              title: payload.msg || "服务开小差啦！",
              icon: "none",
            })
            reject(new Error(payload.msg || "UNKNOWN_ERROR"))
            return
        }
      },
      fail() {
        wx.showToast({
          title: "服务开小差啦！",
          icon: "none",
        })
        reject(new Error("NETWORK_ERROR"))
      },
      complete() {
        if (showLoading) {
          wx.hideLoading()
        }
      },
    })
  })
}

