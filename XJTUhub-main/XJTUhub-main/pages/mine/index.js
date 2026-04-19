import {
  toLogin
} from '../../utils/auth'
const app = getApp()

Page({
  data: {
    hasLogin: false,
    themeMode: 'light',
    pageReady: false,
    stuId: '',
    menuList: [
      {
        title: '考勤信息',
        icon: 'cuIcon-safe',
        path: '/pages/attendance/index'
      },
      {
        title: 'DDL提醒',
        icon: 'cuIcon-calendar',
        path: '/pages/ddl/index'
      },
      {
        title: '课表查询',
        icon: 'cuIcon-read',
        path: '/pages/course/index'
      },
      {
        title: '成绩查询',
        icon: 'cuIcon-rank',
        path: '/pages/score/index'
      }
    ]
  },

  onShow() {
    this.setData({
      themeMode: app.getThemeMode()
    })
    this.syncTabBar()
    this.runPageEnterAnimation()
    this.refreshLoginStatus()
  },

  onUnload() {
    clearTimeout(this._pageAnimTimer)
  },

  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelectedByPath) {
      tabBar.setSelectedByPath('/pages/mine/index')
      tabBar.syncTheme && tabBar.syncTheme()
    }
  },

  runPageEnterAnimation() {
    this.setData({
      pageReady: false
    })
    clearTimeout(this._pageAnimTimer)
    this._pageAnimTimer = setTimeout(() => {
      this.setData({
        pageReady: true
      })
    }, 16)
  },

  refreshLoginStatus() {
    const token = wx.getStorageSync('token')
    if (!token) {
      this.setData({
        hasLogin: false,
        stuId: ''
      })
      return
    }

    const account = wx.getStorageSync('account') || {}
    this.setData({
      hasLogin: true,
      stuId: account.stuId || '已登录用户'
    })
  },

  navPage(e) {
    const path = e.currentTarget.dataset.path
    wx.navigateTo({
      url: path,
      fail() {
        wx.switchTab({
          url: path
        })
      }
    })
  },

  logout() {
    wx.removeStorageSync('token')
    wx.showToast({
      title: '已退出登录',
      icon: 'none'
    })
    this.refreshLoginStatus()
  },

  goLogin() {
    toLogin('/pages/mine/index')
  }
})