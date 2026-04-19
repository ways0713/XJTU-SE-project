import {
  getScoreListRequest,
  getRawScoreListRequest
} from '../../api/main'
const app = getApp()
const scoreCacheKey = "scores"
const rawScoreCacheKey = "rawScores"

Page({

  /**
   * 页面的初始数据
   */
  data: {
    list: [], // 成绩列表
    rawList: [],
    termIndex: 0, // 当前学期索引
    themeMode: 'light',
    pageReady: false,
    showScoreDetail: false,
    activeScoreDetail: null
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.getList()
    this.getRawList()
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

  getList() {
    const cache = wx.getStorageSync(scoreCacheKey)
    if (cache) {
      this.setData({
        list: cache,
        termIndex: this.normalizeTermIndex(this.data.termIndex, cache)
      })
      return
    }
    this.updateValidScore()
  },

  getRawList() {
    const cache = wx.getStorageSync(rawScoreCacheKey)
    if (cache) {
      this.setData({
        rawList: cache
      })
      return
    }
    this.updateRawScore()
  },

  update() {
    Promise.all([
      this.updateValidScore(),
      this.updateRawScore()
    ]).then(() => {
      wx.showToast({
        title: '更新成功',
        icon: 'success'
      })
    }).catch(() => {})
  },

  updateValidScore() {
    return getScoreListRequest()
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : []
        this.setData({
          list,
          termIndex: this.normalizeTermIndex(this.data.termIndex, list)
        })
        wx.setStorageSync(scoreCacheKey, list)
        return list
      })
      .catch(() => [])
  },

  updateRawScore() {
    return getRawScoreListRequest()
      .then(res => {
        const rawList = Array.isArray(res.data) ? res.data : []
        this.setData({
          rawList
        })
        wx.setStorageSync(rawScoreCacheKey, rawList)
        return rawList
      })
      .catch(() => {
        this.setData({
          rawList: []
        })
        wx.removeStorageSync(rawScoreCacheKey)
        return []
      })
  },

  normalizeTermIndex(termIndex, targetList = []) {
    if (!Array.isArray(targetList) || targetList.length === 0) {
      return 0
    }
    const index = Number(termIndex) || 0
    return Math.min(targetList.length - 1, Math.max(0, index))
  },

  changeTerm(e) {
    const termIndex = this.normalizeTermIndex(e.detail.value, this.data.list)
    this.setData({
      termIndex
    })
  },

  hideScoreDetail() {
    this.setData({
      showScoreDetail: false
    })
  },

  openScoreDetail(e) {
    const index = Number(e.currentTarget.dataset.index)
    const term = this.data.list[this.data.termIndex] || {}
    const scoreList = Array.isArray(term.scoreList) ? term.scoreList : []
    const validItem = scoreList[index]

    if (!validItem) {
      return
    }

    const rawItem = this.findRawScoreItem(term.termName, validItem)
    const detailRows = this.buildDetailRows(validItem, rawItem)

    this.setData({
      showScoreDetail: true,
      activeScoreDetail: {
        name: validItem.name || '课程详情',
        termName: term.termName || '--',
        finalScore: validItem.score || '--',
        detailRows
      }
    })
  },

  findRawScoreItem(termName = '', validItem = {}) {
    const courseName = validItem && validItem.name
    const courseNum = validItem && validItem.num
    if (!this.data.rawList.length || (!courseName && !courseNum)) {
      return null
    }
    const termByName = this.data.rawList.find(item => item.termName === termName)
    const fallbackTerm = this.data.rawList[this.data.termIndex] || null
    const matchedTerm = termByName || fallbackTerm

    if (!matchedTerm || !Array.isArray(matchedTerm.scoreList)) {
      return null
    }

    if (courseNum) {
      const byNum = matchedTerm.scoreList.find(item => item.num === courseNum)
      if (byNum) {
        return byNum
      }
    }

    if (courseName) {
      return matchedTerm.scoreList.find(item => item.name === courseName) || null
    }

    return null
  },

  buildDetailRows(validItem = {}, rawItem = null) {
    const rows = [{
      key: 'validScore',
      label: '有效成绩',
      value: this.formatValue(validItem.score)
    }]

    const rawFields = [{
        key: 'normalScore',
        label: '平时成绩'
      },
      {
        key: 'midtermScore',
        label: '期中成绩'
      },
      {
        key: 'finalScore',
        label: '期末成绩'
      },
      {
        key: 'skillScore',
        label: '实验/实践成绩'
      },
      {
        key: 'complexScore',
        label: '总评成绩'
      }
    ]

    rawFields.forEach(field => {
      rows.push({
        key: field.key,
        label: field.label,
        value: this.formatValue(rawItem && rawItem[field.key])
      })
    })

    return rows
  },

  hasValue(value) {
    return value !== undefined && value !== null && value !== ''
  },

  formatValue(value) {
    return this.hasValue(value) ? value : '--'
  }
})
