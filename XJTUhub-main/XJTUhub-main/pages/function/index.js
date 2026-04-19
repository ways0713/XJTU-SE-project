const app = getApp()

Page({
  data: {
    themeMode: 'light',
    pageReady: false,
    featureList: [
      {
        title: '查成绩',
        icon: 'cuIcon-rank',
        desc: '按学期查看成绩与明细',
        path: '/pages/score/index'
      },
      {
        title: '查考勤',
        icon: 'cuIcon-safe',
        desc: '查看课程考勤状态',
        path: '/pages/attendance/index'
      },
      {
        title: 'DDL提醒',
        icon: 'cuIcon-calendar',
        desc: '管理作业和提交截止时间',
        path: '/pages/ddl/index'
      }
    ]
  },

  onShow() {
    this.setData({
      themeMode: app.getThemeMode()
    })
    this.syncTabBar()
    this.runPageEnterAnimation()
  },

  onUnload() {
    clearTimeout(this._pageAnimTimer)
  },

  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelectedByPath) {
      tabBar.setSelectedByPath('/pages/function/index')
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

  navFeature(e) {
    const path = e.currentTarget.dataset.path
    if (!path) {
      return
    }
    wx.navigateTo({
      url: path,
      fail() {
        wx.switchTab({
          url: path
        })
      }
    })
  }
})
