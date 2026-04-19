Component({
  options: {
    addGlobalClass: true
  },

  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        icon: 'cuIcon-discover',
        activeIcon: 'cuIcon-discoverfill'
      },
      {
        pagePath: '/pages/course/index',
        text: '课表',
        icon: 'cuIcon-read',
        activeIcon: 'cuIcon-read'
      },
      {
        pagePath: '/pages/function/index',
        text: '功能',
        icon: 'cuIcon-apps',
        activeIcon: 'cuIcon-apps'
      },
      {
        pagePath: '/pages/mine/index',
        text: '我的',
        icon: 'cuIcon-profile',
        activeIcon: 'cuIcon-profilefill'
      }
    ]
  },

  lifetimes: {
    attached() {
      this.updateSelected()
    }
  },

  pageLifetimes: {
    show() {
      this.updateSelected()
    }
  },

  methods: {
    updateSelected() {
      const pages = getCurrentPages()
      if (!pages || pages.length === 0) {
        return
      }
      const currentRoute = `/${pages[pages.length - 1].route}`
      const selected = this.data.list.findIndex(item => item.pagePath === currentRoute)
      if (selected > -1 && selected !== this.data.selected) {
        this.setData({
          selected
        })
      }
    },

    onSwitchTab(e) {
      const index = e.currentTarget.dataset.index
      const path = this.data.list[index].pagePath
      if (index !== this.data.selected) {
        this.setData({
          selected: index
        })
      }
      wx.switchTab({
        url: path
      })
    },

    setSelectedByPath(path = '') {
      const selected = this.data.list.findIndex(item => item.pagePath === path)
      if (selected > -1) {
        this.setData({
          selected
        })
      }
    }
  }
})
