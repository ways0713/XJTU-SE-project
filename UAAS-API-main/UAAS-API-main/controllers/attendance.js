// XJTU mode currently has no attendance crawler yet.
const getList = async (ctx, next) => {
  ctx.result = []
  return next()
}

const getSimpleList = async (ctx, next) => {
  ctx.result = []
  return next()
}

module.exports = {
  getList,
  getSimpleList,
}
