import { loginRequest, triggerXjtuCrawlerRequest } from "../../api/main"
import { redirectAfterLogin } from "../../utils/auth"

const app = getApp()

Page({
  data: {
    stuId: "",
    password: "",
    saveCount: true,
    redirect: "",
    themeMode: "light",
    pageReady: false,
  },

  onLoad(options) {
    this.setData({
      redirect: options.redirect ? decodeURIComponent(options.redirect) : "",
    })
    this.initAccount()
  },

  onShow() {
    this.setData({
      themeMode: app.getThemeMode(),
    })
    this.runPageEnterAnimation()
  },

  onUnload() {
    clearTimeout(this._pageAnimTimer)
  },

  runPageEnterAnimation() {
    this.setData({ pageReady: false })
    clearTimeout(this._pageAnimTimer)
    this._pageAnimTimer = setTimeout(() => {
      this.setData({ pageReady: true })
    }, 16)
  },

  initAccount() {
    const accountCache = wx.getStorageSync("account")
    if (accountCache) {
      this.setData({
        ...accountCache,
      })
    }
  },

  onStuIdInput(e) {
    this.setData({
      stuId: e.detail.value || "",
    })
  },

  onPasswordInput(e) {
    this.setData({
      password: e.detail.value || "",
    })
  },

  login() {
    const stuId = String(this.data.stuId || "").trim()
    const password = String(this.data.password || "").trim()
    if (!stuId) {
      wx.showToast({
        title: "请输入学号",
        icon: "none",
      })
      return
    }
    if (!password) {
      wx.showToast({
        title: "请输入密码",
        icon: "none",
      })
      return
    }

    const postData = { stuId, password }
    console.log("[login] submit", {
      stuIdLen: stuId.length,
      hasPassword: !!password,
    })

    wx.showLoading({
      title: "登录中",
    })

    loginRequest(postData)
      .then((res) => {
        console.log("[login] response", {
          code: res && res.code,
          hasCookie: !!(res && res.data && res.data.cookie),
        })
        wx.hideLoading()
        if (res.code == -1) {
          wx.showToast({
            title: res.msg,
            icon: "none",
          })
          return
        }

        wx.setStorageSync("token", res.data.cookie)
        if (this.data.saveCount) {
          wx.setStorageSync("account", postData)
        } else {
          wx.removeStorageSync("account")
        }

        triggerXjtuCrawlerRequest(postData).catch((err) => {
          console.warn("[login] trigger crawler failed", err)
        })

        wx.showToast({
          title: "登录成功",
          icon: "none",
        })

        setTimeout(() => {
          redirectAfterLogin(this.data.redirect)
        }, 1500)
      })
      .catch((err) => {
        console.error("[login] request failed", err)
        wx.hideLoading()
        wx.showToast({
          title: "登录失败，请重试",
          icon: "none",
        })
      })
  },

  switchStatus() {
    this.setData({
      saveCount: !this.data.saveCount,
    })
  },

  skipLogin() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({
      url: "/pages/index/index",
    })
  },
})
