const getConfig = (key) => {
  const defaultConfig = {
    SCHOOL_CODE: "13558",
    PORT: 3000,
  }
  if (process.env[key]) {
    return process.env[key]
  }
  if (defaultConfig[key]) {
    return defaultConfig[key]
  }
  return undefined
}

module.exports = getConfig
