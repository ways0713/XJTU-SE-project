const app = getApp()
import {
  getResourceListRequest
} from '../../api/main'

const REQUEST_FALLBACK_TIMEOUT = 8000
const DEFAULT_PAGE_SIZE = 10

Page({
  data: {
    themeMode: 'light',
    pageReady: false,
    categoryList: [{
        label: '全部',
        value: ''
      },
      {
        label: '课件',
        value: 'courseware'
      },
      {
        label: '笔记',
        value: 'note'
      },
      {
        label: '试题',
        value: 'exam'
      }
    ],
    activeCategory: '',
    keywordInput: '',
    keyword: '',
    resourceList: [],
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    hasMore: true,
    isLoading: false,
    isInitLoading: true,
    demoResourceList: [
      {
        id: 'r-1',
        title: '高等数学 第8章重难点课件',
        course: '高等数学',
        type: 'courseware',
        typeText: '课件',
        uploader: '数学社',
        updatedAt: '04-17',
        desc: '包含定积分常考题型拆解与例题推导。'
      },
      {
        id: 'r-2',
        title: '计算机网络实验速查笔记',
        course: '计算机网络',
        type: 'note',
        typeText: '笔记',
        uploader: '网工小组',
        updatedAt: '04-15',
        desc: '覆盖抓包命令、拓扑配置和常见报错定位。'
      },
      {
        id: 'r-3',
        title: '软件工程期中真题整理',
        course: '软件工程',
        type: 'exam',
        typeText: '试题',
        uploader: '学长共享库',
        updatedAt: '04-12',
        desc: '近三年题型汇总，附答题要点与评分点。'
      },
      {
        id: 'r-4',
        title: '大学英语写作模板精选',
        course: '大学英语',
        type: 'courseware',
        typeText: '课件',
        uploader: '英语学习组',
        updatedAt: '04-10',
        desc: '四六级和期末写作模板，附常见句式替换。'
      }
    ]
  },

  onLoad() {
    this.fetchResources({
      reset: true
    })
  },

  onShow() {
    this.setData({
      themeMode: app.getThemeMode()
    })
    this.syncTabBar()
    this.runPageEnterAnimation()
  },

  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelectedByPath) {
      tabBar.setSelectedByPath('/pages/index/index')
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

  onUnload() {
    clearTimeout(this._pageAnimTimer)
    clearTimeout(this._requestFallbackTimer)
  },

  onPullDownRefresh() {
    this.fetchResources({
      reset: true,
      fromPullDown: true
    })
  },

  onReachBottom() {
    if (!this.data.isLoading && this.data.hasMore) {
      this.fetchResources()
    }
  },

  onKeywordInput(e) {
    this.setData({
      keywordInput: e.detail.value || ''
    })
  },

  doSearch() {
    this.setData({
      keyword: (this.data.keywordInput || '').trim()
    })
    this.fetchResources({
      reset: true
    })
  },

  clearSearch() {
    this.setData({
      keywordInput: '',
      keyword: ''
    })
    this.fetchResources({
      reset: true
    })
  },

  switchCategory(e) {
    const category = e.currentTarget.dataset.category || ''
    if (!category || category === this.data.activeCategory) {
      if (category === this.data.activeCategory) {
        return
      }
    }
    this.setData({
      activeCategory: category
    })
    this.fetchResources({
      reset: true
    })
  },

  getTypeText(type = '') {
    const mapping = {
      courseware: '课件',
      note: '笔记',
      exam: '试题'
    }
    return mapping[type] || '资料'
  },

  normalizeResourceItem(item = {}, index = 0) {
    const type = item.type || item.category || item.kind || 'courseware'
    return {
      id: item.id || item.resourceId || `${Date.now()}-${index}`,
      title: item.title || item.name || '未命名资料',
      course: item.course || item.courseName || '未归类课程',
      type,
      typeText: item.typeText || this.getTypeText(type),
      uploader: item.uploader || item.author || '匿名上传',
      updatedAt: item.updatedAt || item.updateTime || item.publishTime || '--',
      desc: item.desc || item.description || '暂无简介',
      url: item.url || item.link || ''
    }
  },

  parseResourceResponse(payload = {}, page = 1) {
    if (Array.isArray(payload)) {
      return {
        list: payload,
        total: payload.length,
        hasMore: payload.length >= this.data.pageSize
      }
    }
    const list = Array.isArray(payload.list) ? payload.list : []
    const total = Number(payload.total) || (page === 1 ? list.length : this.data.total)
    const hasMore = payload.hasMore !== undefined ? !!payload.hasMore : (page * this.data.pageSize < total)
    return {
      list,
      total,
      hasMore
    }
  },

  applyFallbackData() {
    const keyword = (this.data.keyword || '').toLowerCase()
    const activeCategory = this.data.activeCategory
    const list = this.data.demoResourceList.filter(item => {
      const matchCategory = !activeCategory || item.type === activeCategory
      const matcher = `${item.title}${item.course}${item.desc}${item.uploader}`.toLowerCase()
      const matchKeyword = !keyword || matcher.indexOf(keyword) > -1
      return matchCategory && matchKeyword
    })
    this.setData({
      resourceList: list,
      total: list.length,
      page: 1,
      hasMore: false,
      isInitLoading: false,
      isLoading: false
    })
  },

  fetchResources(options = {}) {
    const {
      reset = false,
      fromPullDown = false
    } = options

    if (this.data.isLoading) {
      return
    }

    if (!reset && !this.data.hasMore) {
      return
    }

    const nextPage = reset ? 1 : this.data.page + 1
    const query = {
      page: nextPage,
      pageSize: this.data.pageSize
    }

    if (this.data.activeCategory) {
      query.category = this.data.activeCategory
    }

    if (this.data.keyword) {
      query.keyword = this.data.keyword
    }

    this.setData({
      isLoading: true,
      isInitLoading: reset
    })

    clearTimeout(this._requestFallbackTimer)
    this._requestFallbackTimer = setTimeout(() => {
      if (!this.data.isLoading) {
        return
      }
      this.applyFallbackData()
      if (fromPullDown) {
        wx.stopPullDownRefresh()
      }
      wx.showToast({
        title: '已展示本地示例资料',
        icon: 'none'
      })
    }, REQUEST_FALLBACK_TIMEOUT)

    getResourceListRequest(query)
      .then(res => {
        clearTimeout(this._requestFallbackTimer)
        const parsed = this.parseResourceResponse(res.data, nextPage)
        const normalizedList = parsed.list.map((item, index) => this.normalizeResourceItem(item, index))
        const resourceList = reset ? normalizedList : this.data.resourceList.concat(normalizedList)

        this.setData({
          resourceList,
          page: nextPage,
          total: parsed.total,
          hasMore: parsed.hasMore,
          isLoading: false,
          isInitLoading: false
        })

        if (fromPullDown) {
          wx.stopPullDownRefresh()
        }
      })
      .catch(() => {
        clearTimeout(this._requestFallbackTimer)
        if (this.data.isLoading) {
          this.applyFallbackData()
        }
        if (fromPullDown) {
          wx.stopPullDownRefresh()
        }
      })
  },

  openResource(e) {
    const id = e.currentTarget.dataset.id
    const resource = this.data.resourceList.find(item => item.id === id)
    if (!resource) {
      return
    }
    wx.showToast({
      title: `已打开：${resource.title}`,
      icon: 'none'
    })
  }
})
