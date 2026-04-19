const TAB_PAGE_PATHS = [
  '/pages/index/index',
  '/pages/course/index',
  '/pages/mine/index'
]

function getCurrentPageUrlWithQuery() {
  const pages = getCurrentPages()
  if (!pages || pages.length === 0) {
    return ''
  }
  const currentPage = pages[pages.length - 1]
  const route = currentPage.route ? `/${currentPage.route}` : ''
  const options = currentPage.options || {}
  const queryString = Object.keys(options)
    .map(key => `${key}=${encodeURIComponent(options[key])}`)
    .join('&')

  return queryString ? `${route}?${queryString}` : route
}

function isLoginPage(path = '') {
  return path.indexOf('/pages/login/index') === 0 || path.indexOf('/pages/login-verify/index') === 0
}

export function toLogin(redirectPath = '') {
  const currentPath = getCurrentPageUrlWithQuery()
  if (isLoginPage(currentPath)) {
    return
  }

  const finalRedirect = redirectPath || currentPath
  const query = finalRedirect ? `?redirect=${encodeURIComponent(finalRedirect)}` : ''
  const targetUrl = `/pages/login/index${query}`

  wx.navigateTo({
    url: targetUrl,
    fail() {
      wx.redirectTo({
        url: targetUrl
      })
    }
  })
}

export function redirectAfterLogin(redirectPath = '') {
  const safeRedirectPath = redirectPath || '/pages/index/index'
  const purePath = safeRedirectPath.split('?')[0]

  if (TAB_PAGE_PATHS.indexOf(purePath) > -1) {
    wx.switchTab({
      url: purePath
    })
    return
  }

  wx.redirectTo({
    url: safeRedirectPath
  })
}
