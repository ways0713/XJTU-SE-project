import createRequest from '../utils/request'

export function loginRequest(data) {
  return createRequest({
    url: '/login',
    method: 'POST',
    data,
    needLogin: false
  })
}

export function getScoreListRequest(data) {
  return createRequest({
    url: '/scores',
    data
  })
}

export function getRawScoreListRequest(data) {
  return createRequest({
    url: '/raw-scores',
    data
  })
}

export function getCourseListRequest(data) {
  return createRequest({
    url: '/courses',
    data
  })
}

export function getResourceListRequest(data) {
  return createRequest({
    url: '/resources',
    data,
    needLogin: false,
    loading: false
  })
}

export function triggerXjtuCrawlerRequest(data) {
  return createRequest({
    url: '/crawl/xjtu/trigger',
    method: 'POST',
    data
  })
}

export function getXjtuCrawlerStatusRequest(data) {
  return createRequest({
    url: '/crawl/xjtu/status',
    data
  })
}

// 初始化登录（仅限有验证码的教务系统）
export function initLoginRequest(data) {
  return createRequest({
    url: '/login-init',
    data,
    needLogin: false
  })
}

// 登录（需要验证码的情况）
export function loginWithVerifyRequest(data) {
  return createRequest({
    url: '/login-verify',
    method: 'POST',
    data,
    needLogin: false
  })
}
