"use strict"

const { MongoClient } = require("mongodb")

const DEFAULT_DB_NAME = "xjtuhub"
const DEFAULT_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_MAX_POOL_SIZE = 10

let mongoClient = null
let mongoDb = null
let connectPromise = null
let warnedMissingConfig = false
let warnedConnectError = false

function getDataSource() {
  return String(process.env.DATA_SOURCE || "json").trim().toLowerCase()
}

function isMongoEnabled() {
  return getDataSource() === "mongo"
}

function getMongoConfig() {
  return {
    uri: String(process.env.MONGO_URI || "").trim(),
    dbName: String(process.env.MONGO_DB_NAME || DEFAULT_DB_NAME).trim() || DEFAULT_DB_NAME,
    timeoutMs: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS),
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || DEFAULT_MAX_POOL_SIZE),
  }
}

async function closeMongo() {
  if (!mongoClient) return
  const client = mongoClient
  mongoClient = null
  mongoDb = null
  connectPromise = null
  await client.close().catch(() => {})
}

async function connectMongo() {
  if (!isMongoEnabled()) {
    return null
  }

  if (mongoDb) {
    return mongoDb
  }

  if (connectPromise) {
    return connectPromise
  }

  const { uri, dbName, timeoutMs, maxPoolSize } = getMongoConfig()
  if (!uri) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true
      console.warn("[mongo] DATA_SOURCE=mongo but MONGO_URI is empty. Falling back to local data.")
    }
    return null
  }

  connectPromise = (async () => {
    try {
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_CONNECT_TIMEOUT_MS,
        maxPoolSize: Number.isFinite(maxPoolSize) ? maxPoolSize : DEFAULT_MAX_POOL_SIZE,
      })
      await client.connect()
      mongoClient = client
      mongoDb = client.db(dbName)
      warnedMissingConfig = false
      warnedConnectError = false
      return mongoDb
    } catch (err) {
      await closeMongo()
      if (!warnedConnectError) {
        warnedConnectError = true
        console.warn(
          `[mongo] Connect failed: ${err && err.message ? err.message : "unknown error"}. Falling back to local data.`
        )
      }
      return null
    } finally {
      connectPromise = null
    }
  })()

  return connectPromise
}

async function getCollection(name) {
  if (!name) return null
  const db = await connectMongo()
  if (!db) return null
  return db.collection(name)
}

module.exports = {
  isMongoEnabled,
  getDataSource,
  getCollection,
  connectMongo,
  closeMongo,
}

