const cacheKey = 'ddlList'
const app = getApp()

function buildDefaultList() {
  return [
    {
      id: 'ddl-1',
      title: '软件工程立项报告提交',
      course: '软件工程',
      deadline: '2026-04-20 23:59',
      done: false
    },
    {
      id: 'ddl-2',
      title: '计算机网络实验二',
      course: '计算机网络',
      deadline: '2026-04-23 18:00',
      done: false
    },
    {
      id: 'ddl-3',
      title: '高数作业第8章',
      course: '高等数学',
      deadline: '2026-04-18 22:00',
      done: true
    }
  ]
}

Page({
  data: {
    list: [],
    themeMode: 'light',
    pageReady: false
  },

  onLoad() {
    this.loadList()
  },

  onShow() {
    this.setData({
      themeMode: app.getThemeMode()
    })
    this.runPageEnterAnimation()
  },

  onUnload() {
    clearTimeout(this._pageAnimTimer)
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

  loadList() {
    const cache = wx.getStorageSync(cacheKey)
    if (cache && Array.isArray(cache) && cache.length > 0) {
      this.setData({
        list: cache
      })
      return
    }
    const list = buildDefaultList()
    this.setData({
      list
    })
    wx.setStorageSync(cacheKey, list)
  },

  toggleDone(e) {
    const id = e.currentTarget.dataset.id
    const list = this.data.list.map(item => {
      if (item.id === id) {
        return {
          ...item,
          done: !item.done
        }
      }
      return item
    })
    this.setData({ list })
    wx.setStorageSync(cacheKey, list)
  },

  resetDemoData() {
    const list = buildDefaultList()
    this.setData({ list })
    wx.setStorageSync(cacheKey, list)
    wx.showToast({
      title: '已恢复默认DDL',
      icon: 'none'
    })
  }
})
