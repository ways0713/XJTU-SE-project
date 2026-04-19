import {
  initLoginRequest,
  loginWithVerifyRequest,
  triggerXjtuCrawlerRequest,
} from "../../api/main"
import { redirectAfterLogin } from "../../utils/auth"

const app = getApp()

Page({
  data: {
    stuId: "",
    password: "",
    saveCount: true,
    verifyCode: "",
    showVerify: false,
    redirect: "",
    themeMode: "light",
    pageReady: false,
  },

  onLoad(options) {
    const baseUrl = app.getConfig("baseUrl")
    this.setData({
      baseUrl,
      redirect: options.redirect ? decodeURIComponent(options.redirect) : "",
    })
    this.initAccount()
    this.initLogin()
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

  onVerifyCodeInput(e) {
    this.setData({
      verifyCode: e.detail.value || "",
    })
  },

  initLogin() {
    initLoginRequest()
      .then((res) => {
        this.setData({
          initData: res.data,
          showVerify: true,
        })
        this.downloadVerifyImg()
      })
      .catch((err) => {
        console.warn("[login-verify] initLogin failed", err)
      })
  },

  downloadVerifyImg() {
    if (!this.data.initData || !this.data.initData.cookie) return
    const url = `${this.data.baseUrl}/login-code?cookie=${this.data.initData.cookie}`
    wx.downloadFile({
      url,
      success: (res) => {
        this.setData({
          verifyImageUrl: res.tempFilePath,
        })
      },
      fail: (err) => {
        console.warn("[login-verify] download captcha failed", err)
      },
    })
  },

  login() {
    const stuId = String(this.data.stuId || "").trim()
    const password = String(this.data.password || "").trim()
    const verifyCode = String(this.data.verifyCode || "").trim()

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
    if (this.data.showVerify && !verifyCode) {
      wx.showToast({
        title: "请输入验证码",
        icon: "none",
      })
      return
    }

    const postData = {
      stuId,
      password,
      verifyCode,
      cookie: this.data.initData && this.data.initData.cookie,
      formData: JSON.stringify((this.data.initData && this.data.initData.formData) || {}),
    }

    console.log("[login-verify] submit", {
      stuIdLen: stuId.length,
      hasPassword: !!password,
      hasVerifyCode: !!verifyCode,
      hasCookie: !!postData.cookie,
    })

    wx.showLoading({
      title: "登录中",
    })

    loginWithVerifyRequest(postData)
      .then((res) => {
        console.log("[login-verify] response", {
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
          wx.setStorageSync("account", {
            stuId,
            password,
          })
        } else {
          wx.removeStorageSync("account")
        }

        triggerXjtuCrawlerRequest({ stuId, password }).catch((err) => {
          console.warn("[login-verify] trigger crawler failed", err)
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
        console.error("[login-verify] request failed", err)
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
      wx.navigateBack({
        delta: 1,
      })
      return
    }
    wx.switchTab({
      url: "/pages/index/index",
    })
  },
})
