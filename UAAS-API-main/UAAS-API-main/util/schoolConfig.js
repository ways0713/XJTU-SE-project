const schools = require("../public/schools.json")

const DEFAULT_SCHOOL_CODE = "13558"

const getSchoolConfig = (key = "") => {
  const schoolCode = process.env.SCHOOL_CODE || DEFAULT_SCHOOL_CODE
  const config = schools[schoolCode]
  if (!config) {
    throw new Error(`Unsupported SCHOOL_CODE: ${schoolCode}`)
  }
  return key === "" ? config : config[key]
}

module.exports = getSchoolConfig
