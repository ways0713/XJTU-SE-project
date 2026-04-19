import {
  getCourseListRequest
} from '../../api/main'
import {
  getNowWeek
} from '../../utils/util'
const app = getApp()
const courseCacheKey = "courses"
const courseColorCacheKey = "courseColor"
const courseColorVersionKey = "courseColorVersion"
const courseColorModeKey = "courseColorMode"
const COURSE_COLOR_VERSION = 5
Page({

  /**
   * 页面的初始数据
   */
  data: {
    nowWeek: 1, // 当前周
    themeMode: 'light',
    pageReady: false,
    totalWeek: 20, // 周总数
    showSwitchWeek: false, // 显示选择周数弹窗
    weekDayCount: 7,
    startDate: '2023/02/20', // 开学日期
    weekIndexText: ['一', '二', '三', '四', '五', '六', '日'],
    nowMonth: 1, // 当前周的月份
    courseList: [],
    lightColorList: [
      "#71B7C8",
      "#7D9FDE",
      "#D9A46F",
      "#91BD85",
      "#AA8CCB",
      "#78BDAF",
      "#D88D9B",
      "#8397D8",
      "#84BE9B",
      "#BAC574",
      "#89ADDC",
      "#DDAA82",
    ],
    darkColorList: [
      "#A8DEE4",
      "#B2E2E7",
      "#9FD8DF",
      "#BCE7EC",
      "#A6D8E2",
      "#B7E0E6",
      "#A3D4DE",
      "#B0DEE6",
      "#9CD0DA",
      "#BDE4EA",
      "#AAD9E1",
      "#B5E2E8",
    ],
    courseColor: {},
    weekCalendar: [1, 2, 3, 4, 5, 6, 7],
    firstEntry: true,
    showCourseDetail: false,
    activeCourse: null,
    courseDetailRef: [{
        key: 'weekDay',
        title: '周几'
      },
      {
        key: 'rawWeeks',
        title: '周数'
      },
      {
        key: 'rawSection',
        title: '节数'
      },
      {
        key: 'address',
        title: '地址'
      },
      {
        key: 'teacher',
        title: '老师'
      },
      {
        key: 'credit',
        title: '学分'
      },
      {
        key: 'category',
        title: '类型'
      },
      {
        key: 'method',
        title: '考查'
      }
    ]
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const {
      windowWidth
    } = wx.getSystemInfoSync()
    this.setData({
      windowWidth
    })
    this.getWeekDates()
    this.getNowWeek()
    this.getData()
    this.getTodayDate()
  },

  onShow() {
    const nextThemeMode = app.getThemeMode()
    const shouldRebuildColor = this.data.themeMode !== nextThemeMode && this.data.courseList.length
    this.setData({
      themeMode: nextThemeMode
    })
    if (shouldRebuildColor) {
      this.buildCourseColor()
    }
    this.syncTabBar()
    this.runPageEnterAnimation()
  },

  onUnload() {
    clearTimeout(this._pageAnimTimer)
  },

  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelectedByPath) {
      tabBar.setSelectedByPath('/pages/course/index')
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

  selectWeek() {
    this.setData({
      showSwitchWeek: true
    })
  },

  switchWeek(e) {
    const week = e.currentTarget.dataset.week
    this.setData({
      showSwitchWeek: false
    })
    this.switchWeekFn(week)
  },

  stepWeek(e) {
    const step = Number(e.currentTarget.dataset.step || 0)
    if (!step) {
      return
    }
    const nextWeek = this.data.nowWeek + step
    if (nextWeek < 1 || nextWeek > this.data.totalWeek) {
      return
    }
    this.switchWeekFn(nextWeek)
  },

  // 切换周数
  switchWeekFn(week) {
    const nextWeek = Math.min(this.data.totalWeek, Math.max(1, Number(week) || 1))
    this.setData({
      nowWeek: nextWeek,
      firstEntry: false
    })
    this.getWeekDates()
  },

  hideSwitchWeek() {
    this.setData({
      showSwitchWeek: false
    })
  },

  getWeekDates() {
    const startDate = new Date(this.data.startDate)
    const addTime = (this.data.nowWeek - 1) * 7 * 24 * 60 * 60 * 1000
    const firstDate = startDate.getTime() + addTime
    const {
      month: nowMonth
    } = this.getDateObject(new Date(firstDate))
    const weekCalendar = []
    for (let i = 0; i < this.data.weekDayCount; i++) {
      const date = new Date(firstDate + i * 24 * 60 * 60 * 1000)
      const {
        day
      } = this.getDateObject(date)
      weekCalendar.push(day)
    }
    this.setData({
      nowMonth,
      weekCalendar
    })
  },

  getDateObject(date = new Date()) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return {
      year,
      month,
      day
    }
  },

  getNowWeek() {
    const nowWeek = getNowWeek(this.data.startDate, this.data.totalWeek)
    this.setData({
      nowWeek
    })
    this.getWeekDates()
  },

  getData() {
    const cache = wx.getStorageSync(courseCacheKey)
    const courseColorCache = wx.getStorageSync(courseColorCacheKey)
    const cacheColorVersion = wx.getStorageSync(courseColorVersionKey)
    const cacheColorMode = wx.getStorageSync(courseColorModeKey)
    if (cache) {
      this.setData({
        courseList: cache,
      })
      if (!courseColorCache || cacheColorVersion !== COURSE_COLOR_VERSION || cacheColorMode !== this.data.themeMode) {
        this.buildCourseColor()
      } else {
        this.setData({
          courseColor: courseColorCache
        })
      }
      return
    }
    this.updateFn(true)
  },

  update() {
    this.updateFn()
  },

  updateFn(firstEntry = false) {
    const that = this
    getCourseListRequest()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : []
        that.setData({
          courseList: list
        })
        that.buildCourseColor()
        if (!firstEntry) {
          wx.showToast({
            title: '更新成功',
            icon: 'success'
          })
        }
        wx.setStorageSync(courseCacheKey, list)
      })
      .catch(() => {})
  },

  swiperSwitchWeek(e) {
    if (e.detail.source == '') {
      this.setData({
        firstEntry: false
      })
      return
    }
    const index = e.detail.current
    this.switchWeekFn(index + 1)
  },

  buildCourseColor() {
    const courseColor = {}
    const colorList = this.data.themeMode === 'dark' ? this.data.darkColorList : this.data.lightColorList
    let colorIndex = 0
    this.data.courseList.map(item => {
      if (courseColor[item.name] === undefined) {
        courseColor[item.name] = colorList[colorIndex % colorList.length]
        colorIndex++
      }
    })
    wx.setStorageSync(courseColorCacheKey, courseColor)
    wx.setStorageSync(courseColorVersionKey, COURSE_COLOR_VERSION)
    wx.setStorageSync(courseColorModeKey, this.data.themeMode)
    this.setData({
      courseColor
    })
  },

  // 获取今天日期
  getTodayDate() {
    const {
      month: todayMonth,
      day: todayDay
    } = this.getDateObject()
    this.setData({
      todayMonth,
      todayDay
    })
  },

  formatCourseDetail(course = {}) {
    const weekIndex = Math.max(1, Number(course.week) || 1)
    const weekDay = `周${this.data.weekIndexText[weekIndex - 1] || weekIndex}`
    const sectionStart = Math.max(1, Number(course.section) || 1)
    const sectionCount = Math.max(1, Number(course.sectionCount) || 1)
    const sectionEnd = sectionStart + sectionCount - 1
    const rawSection = course.rawSection || `${sectionStart}-${sectionEnd}节`
    let rawWeeks = course.rawWeeks || ''

    if (!rawWeeks && Array.isArray(course.weeks) && course.weeks.length) {
      const firstWeek = course.weeks[0]
      const lastWeek = course.weeks[course.weeks.length - 1]
      rawWeeks = firstWeek === lastWeek ? `${firstWeek}周` : `${firstWeek}-${lastWeek}周`
    }

    return {
      ...course,
      weekDay,
      rawSection,
      rawWeeks: rawWeeks || '--',
      address: course.address || '未知',
      teacher: course.teacher || '未知',
      credit: course.credit || '--',
      category: course.category || '--',
      method: course.method || '--'
    }
  },

  hideCourseDetail() {
    this.setData({
      showCourseDetail: false
    })
  },

  navCourseDetail(e) {
    const index = e.currentTarget.dataset.index
    const course = this.data.courseList[index]
    if (!course) {
      return
    }
    this.setData({
      showCourseDetail: true,
      activeCourse: this.formatCourseDetail(course)
    })
  }
})
