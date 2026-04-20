"use strict"

const { getCollection } = require("../db/mongo")

const COLLECTION_NAME = "resources"

async function ensureIndexes() {
  const collection = await getCollection(COLLECTION_NAME)
  if (!collection) return
  await collection.createIndex({ id: 1 }, { unique: true })
  await collection.createIndex({ type: 1 })
  await collection.createIndex({ _updatedAtTs: -1 })
}

module.exports = {
  ensureIndexes,
}

