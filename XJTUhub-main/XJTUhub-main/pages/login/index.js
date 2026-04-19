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

  login() {
    const postData = {
      stuId: this.data.stuId,
      password: this.data.password,
    }

    wx.showLoading({
      title: "登录中",
    })

    loginRequest(postData)
      .then((res) => {
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

        // 登录成功后，自动使用当前账号密码触发后台爬取
        triggerXjtuCrawlerRequest(postData).catch(() => {})

        wx.showToast({
          title: "登录成功",
          icon: "none",
        })

        setTimeout(() => {
          redirectAfterLogin(this.data.redirect)
        }, 1500)
      })
      .catch(() => {
        wx.hideLoading()
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
