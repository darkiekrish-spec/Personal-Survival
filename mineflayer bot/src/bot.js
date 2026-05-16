const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const configPath = path.join(__dirname, '..', 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

let bot
let reconnectTimer = null
let activeTask = 'idle'
let followTarget = null
let mcData = null
let defaultMovements = null
let eating = false
let homePosition = null
let guardTarget = null
let lastGuardAttackAt = 0
let practiceTarget = null
let lastPracticeAttackAt = 0
let lastSelfDefenseAt = 0
let lastPanicAt = 0

const hostileMobNames = new Set([
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'cave_spider',
  'enderman',
  'witch',
  'drowned',
  'husk',
  'stray',
  'slime',
  'magma_cube',
  'phantom',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'warden'
])

function createBot () {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version || false
  })

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    mcData = require('minecraft-data')(bot.version)
    defaultMovements = new Movements(bot, mcData)
    defaultMovements.canDig = true
    defaultMovements.maxDropDown = config.maxSafeDrop
    defaultMovements.allow1by1towers = false
    bot.pathfinder.setMovements(defaultMovements)

    activeTask = 'idle'
    console.log(`[bot] Joined ${config.host}:${config.port} as ${config.username} on ${bot.version}`)

    if (config.announceJoin) {
      bot.chat(`Ready. Type ${config.commandPrefix} help`)
    }

    if (config.autoArmor) equipBestArmor().catch(() => {})
  })

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return

    const parsedMessage = parseIncomingMessage(message)
    if (!parsedMessage) return

    if (!canControl(username)) {
      bot.chat(`Sorry ${username}, you are not allowed to control me.`)
      return
    }

    try {
      if (parsedMessage.mode === 'ai') {
        await handleAiRequest(username, parsedMessage.text)
        return
      }

      const [command = 'help', ...args] = parsedMessage.text.split(/\s+/)
      await handleCommand(username, command.toLowerCase(), args)
    } catch (error) {
      console.error(error)
      bot.chat(`Command failed: ${error.message}`)
    }
  })

  bot.on('physicsTick', () => {
    if (followTarget && bot.players[followTarget]?.entity) {
      const target = bot.players[followTarget].entity
      bot.pathfinder.setGoal(new goals.GoalFollow(target, config.followDistance), true)
    }

    if (config.autoEat && bot.food < 14 && !eating) {
      eatFood().catch(() => {})
    }

    if (guardTarget) {
      guardArea().catch(() => {})
    }

    if (practiceTarget) {
      practiceFight().catch(() => {})
    }

    keepBotSafe().catch(() => {})
  })

  bot.on('kicked', reason => console.log('[bot] Kicked:', reason))
  bot.on('error', error => console.log('[bot] Error:', error.message))
  bot.on('end', () => {
    console.log('[bot] Disconnected')
    activeTask = 'offline'
    followTarget = null
    scheduleReconnect()
  })
}

function scheduleReconnect () {
  if (!config.reconnect || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    console.log('[bot] Reconnecting...')
    createBot()
  }, config.reconnectDelayMs)
}

function canControl (username) {
  return config.allowEveryone || config.allowedUsers.includes(username)
}

function parseIncomingMessage (message) {
  if (message.startsWith(config.commandPrefix)) {
    const text = message.slice(config.commandPrefix.length).trim()
    return { mode: 'command', text: text || 'help' }
  }

  if (!config.aiEnabled || !config.listenForName) return null

  const lowered = message.toLowerCase().trim()
  const names = [bot.username.toLowerCase(), ...(config.aiWakeWords || []).map(word => word.toLowerCase())]
  const wakeWord = names.find(name => lowered === name || lowered.startsWith(`${name} `) || lowered.startsWith(`${name},`))
  if (!wakeWord) return null

  const text = message.slice(wakeWord.length).replace(/^[,\s]+/, '').trim()
  return { mode: 'ai', text: text || 'help' }
}

async function handleCommand (username, command, args) {
  switch (command) {
    case 'help':
      return sayHelp()
    case 'ai':
    case 'ask':
      return handleAiRequest(username, args.join(' '))
    case 'aihelp':
      return sayAiHelp()
    case 'buildhelp':
      return sayBuildHelp()
    case 'status':
      return bot.chat(`HP ${bot.health.toFixed(1)} | food ${bot.food} | level ${bot.experience.level} | task ${activeTask}`)
    case 'come':
      return goToPlayer(username)
    case 'follow':
      return startFollowing(args[0] || username)
    case 'stop':
      return stopTask()
    case 'say':
      return bot.chat(args.join(' ') || '...')
    case 'jump':
      return jump()
    case 'sneak':
      bot.setControlState('sneak', true)
      return bot.chat('Sneaking.')
    case 'unsneak':
      bot.setControlState('sneak', false)
      return bot.chat('Stopped sneaking.')
    case 'look':
      return lookAtPlayer(args[0] || username)
    case 'where':
      return sayLocation()
    case 'scan':
      return scanArea()
    case 'sethome':
      return setHome()
    case 'home':
      return goHome()
    case 'guard':
      return startGuarding(args[0] || username)
    case 'unguard':
      return stopGuarding()
    case 'practice':
    case 'spar':
      return startPractice(args[0] || username)
    case 'stoppractice':
    case 'stopspar':
      return stopPractice()
    case 'armor':
      await equipBestArmor()
      return bot.chat('Equipped best armor I can find.')
    case 'eat':
      await eatFood()
      return bot.chat('Ate food if I had any.')
    case 'inv':
    case 'inventory':
      return sayInventory()
    case 'blocks':
      return sayBuildBlocks()
    case 'supply':
      return supplyPlayer(username, args)
    case 'place':
      return placeCommand(args)
    case 'line':
      return buildLine(args)
    case 'wall':
      return buildWall(args)
    case 'floor':
    case 'platform':
      return buildFloor(args)
    case 'bridge':
      return buildBridge(args)
    case 'pillar':
      return buildPillar(args)
    case 'toss':
    case 'drop':
      return tossItem(args)
    case 'collect':
      return collectBlock(args)
    case 'dig':
    case 'mine':
      return mineBlocks(args)
    default:
      return bot.chat(`Unknown command. Type ${config.commandPrefix} help`)
  }
}

function sayHelp () {
  bot.chat(`Commands: help, aihelp, buildhelp, status, come, follow, stop, guard, unguard, practice, stoppractice, sethome, home, where, scan, armor, eat, inv, blocks, supply, place, line, wall, floor, bridge, pillar, toss, collect, dig, look, jump, sneak, unsneak, say`)
}

function sayAiHelp () {
  bot.chat(`AI phrases: "${bot.username} come here", "${bot.username} follow me", "${bot.username} build a 5 by 3 wall with cobblestone north", "${bot.username} give me 32 dirt", "${bot.username} collect 5 oak_log", "${bot.username} guard me", "${bot.username} practice with me", "${bot.username} what can you do"`)
}

function sayBuildHelp () {
  bot.chat(`Build: place <block> [front|under|x y z], line <block> <length> [dir], wall <block> <width> <height> [dir], floor <block> <w> <d> [dir], bridge <block> <length> [dir], pillar <block> <height>, blocks, supply <item> [count] [player]`)
}

async function goToPlayer (username) {
  const playerName = findVisiblePlayerName(username)
  const player = playerName ? bot.players[playerName]?.entity : null
  if (!player) return bot.chat(`I cannot see ${username}.`)
  activeTask = `going to ${username}`
  followTarget = null
  await bot.pathfinder.goto(new goals.GoalNear(player.position.x, player.position.y, player.position.z, config.followDistance))
  activeTask = 'idle'
  bot.chat(`I'm here, ${playerName}.`)
}

function startFollowing (username) {
  const playerName = findVisiblePlayerName(username)
  if (!playerName || !bot.players[playerName]?.entity) return bot.chat(`I cannot see ${username}.`)
  followTarget = playerName
  activeTask = `following ${playerName}`
  bot.chat(`Following ${playerName}.`)
}

function stopTask () {
  followTarget = null
  guardTarget = null
  practiceTarget = null
  activeTask = 'idle'
  bot.pathfinder.stop()
  bot.clearControlStates()
  bot.chat('Stopped.')
}

async function handleAiRequest (username, text) {
  const request = normalizeText(text)
  if (!request || request === 'help' || request.includes('what can you do')) {
    return sayAiHelp()
  }

  if (matchesAny(request, ['come here', 'come to me', 'come over', 'get over here'])) return goToPlayer(username)
  if (matchesAny(request, ['follow me', 'stay with me'])) return startFollowing(username)
  if (matchesAny(request, ['stop', 'stop moving', 'cancel', 'wait'])) return stopTask()
  if (matchesAny(request, ['where are you', 'your coords', 'your coordinates', 'location'])) return sayLocation()
  if (matchesAny(request, ['scan', 'look around', 'what is nearby', 'nearby'])) return scanArea()
  if (matchesAny(request, ['set home', 'remember this place', 'save home'])) return setHome()
  if (matchesAny(request, ['go home', 'return home'])) return goHome()
  if (matchesAny(request, ['guard me', 'protect me', 'watch me'])) return startGuarding(username)
  if (matchesAny(request, ['stop guarding', 'unguard', 'stop protecting'])) return stopGuarding()
  if (matchesAny(request, ['practice with me', 'spar with me', 'fight practice', 'train with me'])) return startPractice(username)
  if (matchesAny(request, ['stop practice', 'stop sparring', 'stop training'])) return stopPractice()
  if (matchesAny(request, ['wear armor', 'equip armor', 'put on armor'])) {
    await equipBestArmor()
    return bot.chat('Equipped best armor I can find.')
  }
  if (matchesAny(request, ['eat food', 'eat something'])) {
    await eatFood()
    return bot.chat('Ate food if I had any.')
  }
  if (matchesAny(request, ['show inventory', 'what do you have', 'inventory'])) return sayInventory()
  if (matchesAny(request, ['building blocks', 'blocks do you have'])) return sayBuildBlocks()

  const practiceIntent = parsePracticeIntent(request)
  if (practiceIntent) return startPractice(practiceIntent.player || username)

  const supplyIntent = parseSupplyIntent(request)
  if (supplyIntent) return supplyPlayer(username, [supplyIntent.item, String(supplyIntent.count), username])

  const collectIntent = parseCollectIntent(request)
  if (collectIntent) return collectBlock([collectIntent.block, String(collectIntent.count)])

  const buildIntent = parseBuildIntent(request)
  if (buildIntent) return runBuildIntent(buildIntent)

  const digIntent = parseDigIntent(request)
  if (digIntent) return mineBlocks([digIntent.block, String(digIntent.count)])

  bot.chat(`I understood the words, but not the task. Try ${config.commandPrefix} aihelp`)
}

function normalizeText (text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function matchesAny (text, phrases) {
  return phrases.some(phrase => text.includes(phrase))
}

function parseSupplyIntent (text) {
  const match = text.match(/\b(?:give|bring|drop|supply)\s+(?:me\s+)?(?:(\d+)\s+)?([a-z0-9_]+(?:\s+[a-z0-9_]+)?)/)
  if (!match) return null
  return {
    count: Number.parseInt(match[1] || '16', 10),
    item: normalizeItemName(match[2])
  }
}

function parseCollectIntent (text) {
  const parsed = parseBlockQuantity(text, ['collect', 'get', 'gather', 'farm'])
  if (!parsed) return null
  return {
    count: parsed.count,
    block: parsed.block
  }
}

function parseDigIntent (text) {
  const parsed = parseBlockQuantity(text, ['dig', 'mine', 'break'])
  if (!parsed) return null
  return {
    block: parsed.block,
    count: parsed.count
  }
}

function parseBlockQuantity (text, verbs) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const verbIndex = tokens.findIndex(token => verbs.includes(token))
  if (verbIndex === -1) return null

  const skipWords = new Set(['some', 'me', 'nearby'])
  const stopWords = new Set(['with', 'using', 'from', 'out', 'north', 'south', 'east', 'west'])
  const blockTokens = []
  let quantity
  let unit

  for (const token of tokens.slice(verbIndex + 1)) {
    if (skipWords.has(token)) continue
    if (stopWords.has(token)) break
    if (isQuantityToken(token)) {
      quantity = token
      continue
    }
    if (token === 'stack' || token === 'stacks' || token === 'block' || token === 'blocks') {
      unit = token
      continue
    }
    if (quantity) break
    blockTokens.push(token)
  }

  if (!blockTokens.length) return null

  return {
    block: normalizeItemName(blockTokens.join('_')),
    count: parseQuantity(quantity, unit, config.defaultCollectCount)
  }
}

function isQuantityToken (token) {
  return /^\d+$/.test(token) || ['a', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].includes(token)
}

function parsePracticeIntent (text) {
  const match = text.match(/\b(?:kill|attack|fight|duel|spar|practice with)\s+([a-z0-9_]+)/)
  if (!match) return null
  return { player: match[1] }
}

function parseBuildIntent (text) {
  const direction = parseDirection(text)
  const block = parseBlockFromText(text)

  let match = text.match(/\b(?:build|make|create)\s+(?:a\s+)?(\d+)\s*(?:x|by)\s*(\d+)\s+(wall|floor|platform|bridge|line|pillar)\b/)
  if (match) {
    return {
      shape: match[3],
      block,
      first: Number.parseInt(match[1], 10),
      second: Number.parseInt(match[2], 10),
      direction
    }
  }

  match = text.match(/\b(?:build|make|create)\s+(?:a\s+)?(wall|floor|platform|bridge|line|pillar)\s+(?:(\d+)\s*(?:x|by)\s*(\d+)|(\d+))?/)
  if (!match) return null

  return {
    shape: match[1],
    block,
    first: Number.parseInt(match[2] || match[4] || defaultBuildSize(match[1]).first, 10),
    second: Number.parseInt(match[3] || defaultBuildSize(match[1]).second, 10),
    direction
  }
}

function parseBlockFromText (text) {
  const material = parseMaterialPhrase(text)
  if (material) return material

  const available = Object.keys(getBuildBlockCounts())
  return available[0] || 'dirt'
}

function parseMaterialPhrase (text) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const start = tokens.findIndex((token, index) => {
    return ['with', 'using', 'from'].includes(token) || (token === 'of' && tokens[index - 1] === 'out')
  })
  if (start === -1) return null

  const materialTokens = []
  const stopWords = new Set(['north', 'south', 'east', 'west', 'wall', 'floor', 'platform', 'bridge', 'line', 'pillar'])
  for (const token of tokens.slice(start + 1)) {
    if (token === 'of' || token === 'out') continue
    if (stopWords.has(token) || isQuantityToken(token)) break
    materialTokens.push(token)
    if (materialTokens.length >= 2) break
  }

  return materialTokens.length ? normalizeItemName(materialTokens.join('_')) : null
}

function parseDirection (text) {
  return ['north', 'south', 'east', 'west'].find(direction => text.includes(direction))
}

function defaultBuildSize (shape) {
  if (shape === 'wall') return { first: 5, second: 3 }
  if (shape === 'floor' || shape === 'platform') return { first: 5, second: 5 }
  if (shape === 'pillar') return { first: 4, second: 1 }
  return { first: 6, second: 1 }
}

async function runBuildIntent (intent) {
  const block = intent.block
  const direction = intent.direction

  if (intent.shape === 'wall') return buildWall([block, String(intent.first), String(intent.second), direction].filter(Boolean))
  if (intent.shape === 'floor' || intent.shape === 'platform') return buildFloor([block, String(intent.first), String(intent.second), direction].filter(Boolean))
  if (intent.shape === 'bridge') return buildBridge([block, String(intent.first), direction].filter(Boolean))
  if (intent.shape === 'line') return buildLine([block, String(intent.first), direction].filter(Boolean))
  if (intent.shape === 'pillar') return buildPillar([block, String(intent.first)])
}

function sayLocation () {
  const pos = bot.entity.position.floored()
  bot.chat(`I am at x:${pos.x} y:${pos.y} z:${pos.z} in ${bot.game.dimension}. Task: ${activeTask}`)
}

function setHome () {
  homePosition = bot.entity.position.floored()
  bot.chat(`Home saved at x:${homePosition.x} y:${homePosition.y} z:${homePosition.z}.`)
}

async function goHome () {
  if (!homePosition) return bot.chat('No home saved yet. Use sethome first.')
  activeTask = 'going home'
  followTarget = null
  await bot.pathfinder.goto(new goals.GoalNear(homePosition.x, homePosition.y, homePosition.z, 1))
  activeTask = 'idle'
  bot.chat('I am home.')
}

function scanArea () {
  const players = Object.keys(bot.players).filter(name => name !== bot.username).slice(0, 5)
  const mobs = Object.values(bot.entities)
    .filter(entity => entity.type === 'mob')
    .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
    .slice(0, 5)
    .map(entity => entity.name)

  const pos = bot.entity.position.floored()
  bot.chat(`Scan x:${pos.x} y:${pos.y} z:${pos.z} | players: ${players.join(', ') || 'none'} | mobs: ${mobs.join(', ') || 'none'}`)
}

function startGuarding (username) {
  const playerName = findVisiblePlayerName(username)
  if (!playerName || !bot.players[playerName]?.entity) return bot.chat(`I cannot see ${username}.`)
  guardTarget = playerName
  followTarget = playerName
  activeTask = `guarding ${playerName}`
  bot.chat(`Guarding ${playerName}. I will attack nearby hostile mobs.`)
}

function stopGuarding () {
  guardTarget = null
  if (activeTask.startsWith('guarding')) activeTask = 'idle'
  bot.chat('Guard mode off.')
}

function startPractice (username) {
  const playerName = findVisiblePlayerName(username)
  if (!playerName || !bot.players[playerName]?.entity) return bot.chat(`I cannot see ${username}.`)
  guardTarget = null
  followTarget = playerName
  practiceTarget = playerName
  activeTask = `practicing with ${playerName}`
  bot.chat(`Practice mode on with ${playerName}. I will spar slowly. Use ${config.commandPrefix} stoppractice to stop.`)
}

function stopPractice () {
  practiceTarget = null
  if (activeTask.startsWith('practicing')) activeTask = 'idle'
  bot.chat('Practice mode off.')
}

async function guardArea () {
  const now = Date.now()
  if (now - lastGuardAttackAt < 1200) return

  const targetPlayer = bot.players[guardTarget]?.entity
  if (!targetPlayer) {
    guardTarget = null
    activeTask = 'idle'
    bot.chat('Guard target is gone.')
    return
  }

  const hostile = Object.values(bot.entities)
    .filter(entity => entity.type === 'mob' && hostileMobNames.has(entity.name))
    .filter(entity => entity.position.distanceTo(targetPlayer.position) <= config.guardRange)
    .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))[0]

  if (!hostile) return

  lastGuardAttackAt = now
  if (bot.entity.position.distanceTo(hostile.position) > 3) {
    bot.pathfinder.setGoal(new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2), false)
    return
  }

  await bot.lookAt(hostile.position.offset(0, 1, 0), true)
  await equipBestWeapon()
  bot.attack(hostile)
}

async function practiceFight () {
  const now = Date.now()
  if (now - lastPracticeAttackAt < config.practiceAttackDelayMs) return

  const target = bot.players[practiceTarget]?.entity
  if (!target) {
    practiceTarget = null
    activeTask = 'idle'
    bot.chat('Practice target is gone.')
    return
  }

  lastPracticeAttackAt = now
  const distance = bot.entity.position.distanceTo(target.position)
  if (distance > config.practiceRange) {
    bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2), false)
    return
  }

  await equipBestWeapon()
  await bot.lookAt(target.position.offset(0, 1.5, 0), true)
  bot.attack(target)
}

async function keepBotSafe () {
  if (config.panicHealth && bot.health > 0 && bot.health <= config.panicHealth) {
    await panicRecover()
    return
  }

  if (config.avoidCreepers) {
    const creeper = findNearestHostile(['creeper'], config.creeperAvoidRange)
    if (creeper) {
      moveAwayFrom(creeper.position, 7)
      return
    }
  }

  if (config.autoSelfDefense) {
    const hostile = findNearestHostile([...hostileMobNames], config.selfDefenseRange)
    if (hostile) await defendAgainst(hostile)
    if (!hostile && activeTask === 'defending self') activeTask = 'idle'
  }
}

async function panicRecover () {
  const now = Date.now()
  if (now - lastPanicAt < 2500) return
  lastPanicAt = now

  followTarget = null
  guardTarget = null
  practiceTarget = null
  activeTask = 'recovering'
  bot.pathfinder.stop()

  if (config.autoEat && bot.food < 20 && !eating) {
    await eatFood().catch(() => {})
  }

  const hostile = findNearestHostile([...hostileMobNames], config.selfDefenseRange + 3)
  if (hostile) moveAwayFrom(hostile.position, 8)
}

async function defendAgainst (entity) {
  const now = Date.now()
  if (now - lastSelfDefenseAt < 1000) return
  lastSelfDefenseAt = now

  if (entity.name === 'creeper' && bot.entity.position.distanceTo(entity.position) <= config.creeperAvoidRange) {
    moveAwayFrom(entity.position, 8)
    return
  }

  activeTask = activeTask === 'idle' ? 'defending self' : activeTask

  if (bot.entity.position.distanceTo(entity.position) > 3) {
    bot.pathfinder.setGoal(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2), false)
    return
  }

  await equipBestWeapon()
  await bot.lookAt(entity.position.offset(0, 1, 0), true)
  bot.attack(entity)
}

function findNearestHostile (names, range) {
  const allowedNames = new Set(names)
  return Object.values(bot.entities)
    .filter(entity => entity.type === 'mob' && allowedNames.has(entity.name))
    .filter(entity => entity.position.distanceTo(bot.entity.position) <= range)
    .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))[0]
}

function moveAwayFrom (dangerPosition, distance) {
  const position = bot.entity.position
  const away = position.minus(dangerPosition)
  const length = Math.max(Math.sqrt(away.x * away.x + away.z * away.z), 0.001)
  const target = position.offset((away.x / length) * distance, 0, (away.z / length) * distance).floored()
  bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 2), false)
}

async function equipBestWeapon () {
  const weaponNames = [
    'netherite_sword',
    'diamond_sword',
    'iron_sword',
    'stone_sword',
    'golden_sword',
    'wooden_sword',
    'netherite_axe',
    'diamond_axe',
    'iron_axe',
    'stone_axe',
    'golden_axe',
    'wooden_axe'
  ]

  const weapon = weaponNames
    .map(name => bot.inventory.items().find(item => item.name === name))
    .find(Boolean)

  if (weapon) await bot.equip(weapon, 'hand')
}

function jump () {
  bot.setControlState('jump', true)
  setTimeout(() => bot.setControlState('jump', false), 350)
  bot.chat('Jumped.')
}

async function lookAtPlayer (username) {
  const player = bot.players[username]?.entity
  if (!player) return bot.chat(`I cannot see ${username}.`)
  await bot.lookAt(player.position.offset(0, 1.6, 0), true)
  bot.chat(`Looking at ${username}.`)
}

async function equipBestArmor () {
  const slots = [
    { slot: 'head', names: ['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'chainmail_helmet', 'golden_helmet', 'leather_helmet'] },
    { slot: 'torso', names: ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'chainmail_chestplate', 'golden_chestplate', 'leather_chestplate'] },
    { slot: 'legs', names: ['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'chainmail_leggings', 'golden_leggings', 'leather_leggings'] },
    { slot: 'feet', names: ['netherite_boots', 'diamond_boots', 'iron_boots', 'chainmail_boots', 'golden_boots', 'leather_boots'] }
  ]

  for (const armorSlot of slots) {
    const item = armorSlot.names
      .map(name => bot.inventory.items().find(invItem => invItem.name === name))
      .find(Boolean)
    if (item) await bot.equip(item, armorSlot.slot)
  }
}

async function eatFood () {
  if (eating) return
  const food = bot.inventory.items().find(item => {
    const data = mcData.foodsByName[item.name]
    return data && data.foodPoints > 0
  })

  if (!food) throw new Error('No food in inventory')
  eating = true
  try {
    await bot.equip(food, 'hand')
    await bot.consume()
  } finally {
    eating = false
  }
}

function sayInventory () {
  const counts = {}
  for (const item of bot.inventory.items()) {
    counts[item.name] = (counts[item.name] || 0) + item.count
  }

  const summary = Object.entries(counts)
    .slice(0, 8)
    .map(([name, count]) => `${name}x${count}`)
    .join(', ')

  bot.chat(summary || 'Inventory is empty.')
}

function sayBuildBlocks () {
  const blocks = getBuildBlockCounts()
  const summary = Object.entries(blocks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}x${count}`)
    .join(', ')

  bot.chat(summary || 'I have no placeable building blocks.')
}

async function supplyPlayer (requester, args) {
  const itemName = normalizeItemName(args[0])
  const count = parseQuantity(args[1], args[2], 16)
  const targetName = args[2] || requester
  if (!itemName) return bot.chat(`Usage: ${config.commandPrefix} supply <item> [count] [player]`)
  if (!Number.isFinite(count) || count < 1) return bot.chat('Count must be a positive number.')

  const playerName = findVisiblePlayerName(targetName)
  const target = playerName ? bot.players[playerName]?.entity : null
  if (!target) return bot.chat(`I cannot see ${targetName}.`)

  const item = findInventoryItem(itemName)
  if (!item) return bot.chat(`I do not have ${itemName}.`)

  activeTask = `supplying ${targetName}`
  followTarget = null
  await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2))
  await bot.toss(item.type, null, Math.min(count, item.count))
  activeTask = 'idle'
  bot.chat(`Dropped ${Math.min(count, item.count)} ${item.name} for ${playerName}.`)
}

async function placeCommand (args) {
  const blockName = normalizeItemName(args[0])
  if (!blockName) return bot.chat(`Usage: ${config.commandPrefix} place <block> [front|under|x y z]`)

  const positionArgs = args.slice(1)
  let position

  if (positionArgs.length >= 3 && positionArgs.slice(0, 3).every(value => Number.isFinite(Number(value)))) {
    position = new Vec3(Number(positionArgs[0]), Number(positionArgs[1]), Number(positionArgs[2]))
  } else {
    const where = positionArgs[0] || 'front'
    position = getRelativeBuildPosition(where)
  }

  activeTask = `placing ${blockName}`
  followTarget = null
  const placed = await placeBlocks(blockName, [position])
  activeTask = 'idle'
  bot.chat(placed ? `Placed ${blockName}.` : `Could not place ${blockName}.`)
}

async function buildLine (args) {
  const blockName = normalizeItemName(args[0])
  const length = Number.parseInt(args[1] || '0', 10)
  const direction = getDirection(args[2])
  if (!blockName || !Number.isFinite(length) || length < 1) return bot.chat(`Usage: ${config.commandPrefix} line <block> <length> [north|south|east|west]`)

  const start = bot.entity.position.floored().offset(direction.x, 0, direction.z)
  const positions = Array.from({ length }, (_, index) => start.plus(direction.scaled(index)))
  await runBuild(`line ${blockName}`, blockName, positions)
}

async function buildWall (args) {
  const blockName = normalizeItemName(args[0])
  const width = Number.parseInt(args[1] || '0', 10)
  const height = Number.parseInt(args[2] || '0', 10)
  const direction = getDirection(args[3])
  if (!blockName || width < 1 || height < 1) return bot.chat(`Usage: ${config.commandPrefix} wall <block> <width> <height> [north|south|east|west]`)

  const start = bot.entity.position.floored().offset(direction.x, 0, direction.z)
  const side = new Vec3(direction.z, 0, -direction.x)
  const positions = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      positions.push(start.plus(side.scaled(x)).offset(0, y, 0))
    }
  }

  await runBuild(`wall ${blockName}`, blockName, positions)
}

async function buildFloor (args) {
  const blockName = normalizeItemName(args[0])
  const width = Number.parseInt(args[1] || '0', 10)
  const depth = Number.parseInt(args[2] || '0', 10)
  const direction = getDirection(args[3])
  if (!blockName || width < 1 || depth < 1) return bot.chat(`Usage: ${config.commandPrefix} floor <block> <width> <depth> [north|south|east|west]`)

  const start = bot.entity.position.floored().offset(direction.x, -1, direction.z)
  const side = new Vec3(direction.z, 0, -direction.x)
  const positions = []
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      positions.push(start.plus(direction.scaled(z)).plus(side.scaled(x)))
    }
  }

  await runBuild(`floor ${blockName}`, blockName, positions)
}

async function buildBridge (args) {
  const blockName = normalizeItemName(args[0])
  const length = Number.parseInt(args[1] || '0', 10)
  const direction = getDirection(args[2])
  if (!blockName || length < 1) return bot.chat(`Usage: ${config.commandPrefix} bridge <block> <length> [north|south|east|west]`)

  const start = bot.entity.position.floored().offset(direction.x, -1, direction.z)
  const positions = Array.from({ length }, (_, index) => start.plus(direction.scaled(index)))
  await runBuild(`bridge ${blockName}`, blockName, positions)
}

async function buildPillar (args) {
  const blockName = normalizeItemName(args[0])
  const height = Number.parseInt(args[1] || '0', 10)
  if (!blockName || height < 1) return bot.chat(`Usage: ${config.commandPrefix} pillar <block> <height>`)

  const start = bot.entity.position.floored().offset(1, 0, 0)
  const positions = Array.from({ length: height }, (_, index) => start.offset(0, index, 0))
  await runBuild(`pillar ${blockName}`, blockName, positions)
}

async function runBuild (taskName, blockName, positions) {
  const limitedPositions = positions.slice(0, config.maxBuildBlocks)
  if (positions.length > limitedPositions.length) {
    bot.chat(`Build capped at ${config.maxBuildBlocks} blocks.`)
  }

  activeTask = taskName
  followTarget = null
  const placed = await placeBlocks(blockName, limitedPositions)
  activeTask = 'idle'
  bot.chat(`Placed ${placed}/${limitedPositions.length} ${blockName}.`)
}

async function placeBlocks (blockName, positions) {
  const blockItem = findInventoryItem(blockName)
  if (!blockItem) throw new Error(`I do not have ${blockName}`)

  let placed = 0
  for (const position of positions) {
    const item = findInventoryItem(blockName)
    if (!item) break

    const targetBlock = bot.blockAt(position)
    if (!targetBlock || targetBlock.name !== 'air') continue

    const placement = findPlacementReference(position)
    if (!placement) continue

    await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 3))
    await bot.equip(item, 'hand')
    await bot.lookAt(position.offset(0.5, 0.5, 0.5), true)
    await bot.placeBlock(placement.referenceBlock, placement.faceVector)
    placed += 1
  }

  return placed
}

function findPlacementReference (position) {
  const faceVectors = [
    new Vec3(0, -1, 0),
    new Vec3(0, 1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1)
  ]

  for (const faceVector of faceVectors) {
    const referenceBlock = bot.blockAt(position.minus(faceVector))
    if (referenceBlock && referenceBlock.boundingBox === 'block') {
      return { referenceBlock, faceVector }
    }
  }

  return null
}

function getRelativeBuildPosition (where) {
  const base = bot.entity.position.floored()
  const direction = getDirection()

  switch (where) {
    case 'under':
    case 'down':
      return base.offset(0, -1, 0)
    case 'above':
    case 'up':
      return base.offset(0, 2, 0)
    case 'back':
      return base.minus(direction)
    case 'left':
      return base.offset(direction.z, 0, -direction.x)
    case 'right':
      return base.offset(-direction.z, 0, direction.x)
    case 'front':
    default:
      return base.plus(direction)
  }
}

function getDirection (directionName) {
  const directions = {
    north: new Vec3(0, 0, -1),
    south: new Vec3(0, 0, 1),
    east: new Vec3(1, 0, 0),
    west: new Vec3(-1, 0, 0)
  }

  if (directionName && directions[directionName]) return directions[directionName]

  const yaw = bot.entity.yaw
  const x = Math.round(-Math.sin(yaw))
  const z = Math.round(-Math.cos(yaw))
  if (Math.abs(x) > Math.abs(z)) return new Vec3(Math.sign(x), 0, 0)
  return new Vec3(0, 0, Math.sign(z) || 1)
}

function getBuildBlockCounts () {
  const counts = {}
  for (const item of bot.inventory.items()) {
    const block = mcData.blocksByName[item.name]
    if (block && block.boundingBox === 'block') {
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
  }

  return counts
}

async function tossItem (args) {
  const itemName = args[0]
  const count = Number.parseInt(args[1] || '1', 10)
  if (!itemName) return bot.chat(`Usage: ${config.commandPrefix} toss <item> [count]`)
  if (!Number.isFinite(count) || count < 1) return bot.chat('Count must be a positive number.')

  const item = findInventoryItem(itemName)
  if (!item) return bot.chat(`I do not have ${itemName}.`)

  await bot.toss(item.type, null, Math.min(count, item.count))
  bot.chat(`Dropped ${Math.min(count, item.count)} ${item.name}.`)
}

async function collectBlock (args) {
  const blockName = normalizeItemName(args[0])
  const count = Math.min(parseQuantity(args[1], args[2], config.defaultCollectCount), config.maxCollectBlocks)
  if (!blockName) return bot.chat(`Usage: ${config.commandPrefix} collect <block> [count]`)
  if (!Number.isFinite(count) || count < 1) return bot.chat('Count must be a positive number.')

  activeTask = `collecting ${blockName}`
  followTarget = null

  let collected = 0
  let attempts = 0
  while (collected < count && attempts < count * 4) {
    attempts += 1
    const block = findNearestBlock(blockName)
    if (!block) break
    try {
      await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1))
      await bot.dig(block)
      collected += 1
    } catch (error) {
      if (!isRecoverablePathError(error)) throw error
    }
  }

  activeTask = 'idle'
  bot.chat(collected > 0 ? `Collected ${collected} ${blockName}.` : `No nearby ${blockName} found.`)
}

async function mineBlocks (args) {
  const blockName = normalizeItemName(args[0])
  const count = Math.min(parseQuantity(args[1], args[2], config.defaultCollectCount), config.maxCollectBlocks)
  if (!blockName) return bot.chat(`Usage: ${config.commandPrefix} mine <block> [count|stacks]`)
  return collectBlock([blockName, String(count)])
}

async function digNearest (args) {
  const blockName = normalizeItemName(args[0])
  if (!blockName) return bot.chat(`Usage: ${config.commandPrefix} dig <block>`)

  const block = findNearestBlock(blockName)
  if (!block) return bot.chat(`No nearby ${blockName} found.`)

  activeTask = `digging ${blockName}`
  followTarget = null
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1))
  await bot.dig(block)
  activeTask = 'idle'
  bot.chat(`Dug ${blockName}.`)
}

function findNearestBlock (blockName) {
  const resolvedBlockName = resolveBlockName(blockName)
  const blockId = mcData.blocksByName[resolvedBlockName]?.id
  if (!blockId) throw new Error(`Unknown block: ${blockName}`)

  return bot.findBlock({
    matching: blockId,
    maxDistance: 32,
    count: 1
  })
}

function findInventoryItem (query) {
  const normalized = normalizeItemName(query)
  return bot.inventory.items().find(item => item.name === normalized || item.name.includes(normalized))
}

function normalizeItemName (query) {
  return String(query || '').toLowerCase().trim().replace(/[\s-]+/g, '_')
}

function resolveBlockName (query) {
  const normalized = normalizeItemName(query)
  if (mcData.blocksByName[normalized]) return normalized

  const suffixMatches = Object.keys(mcData.blocksByName)
    .filter(name => name.endsWith(`_${normalized}`) || name.includes(normalized))

  if (suffixMatches.length === 1) return suffixMatches[0]

  const logMatch = suffixMatches.find(name => name.endsWith('_log'))
  if (logMatch) return logMatch

  const blockMatch = suffixMatches.find(name => mcData.blocksByName[name].boundingBox === 'block')
  if (blockMatch) return blockMatch

  throw new Error(`Unknown block: ${query}`)
}

function parseQuantity (value, unit, fallback) {
  const words = {
    a: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  }

  const raw = String(value || '').toLowerCase()
  const amount = words[raw] || Number.parseInt(raw || fallback, 10)
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : fallback
  return String(unit || '').toLowerCase().startsWith('stack') ? safeAmount * 64 : safeAmount
}

function isRecoverablePathError (error) {
  return /goal was changed|path was stopped|interrupted/i.test(error.message || '')
}

function findVisiblePlayerName (username) {
  const normalized = String(username || '').toLowerCase()
  return Object.keys(bot.players).find(name => name.toLowerCase() === normalized)
}

createBot()
