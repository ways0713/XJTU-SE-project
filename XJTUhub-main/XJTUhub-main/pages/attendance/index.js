const cacheKey = 'attendanceList'
const app = getApp()

const defaultAttendanceList = [
  {
    courseName: '高等数学',
    teacher: '王老师',
    absences: 0,
    late: 1,
    leave: 0,
    risk: 'normal'
  },
  {
    courseName: '大学英语',
    teacher: '李老师',
    absences: 2,
    late: 0,
    leave: 1,
    risk: 'warning'
  },
  {
    courseName: '计算机网络',
    teacher: '张老师',
    absences: 4,
    late: 2,
    leave: 0,
    risk: 'danger'
  }
]

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
    this.mockSync()
  },

  mockSync() {
    wx.setStorageSync(cacheKey, defaultAttendanceList)
    this.setData({
      list: defaultAttendanceList
    })
    wx.showToast({
      title: '已同步示例数据',
      icon: 'none'
    })
  }
})
