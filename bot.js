const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const armorManager = require('mineflayer-armor-manager')
const minecraftData = require('minecraft-data')
const { GoalNear } = require('mineflayer-pathfinder').goals


const host = 'Bigskidbiglarp.aternos.me'  //Bigskidbiglarp.aternos.me
const port = 54126 // 54126
const username = 'slave'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Memory management - force garbage collection periodically
if (global.gc) {
  setInterval(() => {
    global.gc()
    console.log('🧹 Garbage collection triggered')
  }, 60000) // Every minute
} else {
  console.log('⚠️ Run with --expose-gc flag for better memory management: node --expose-gc bot.js')
}

// Filter out packet parsing errors from console
const originalConsoleError = console.error
console.error = function(...args) {
  const message = args.join(' ')
  // Ignore packet parsing errors
  if (message.includes('Chunk size') || message.includes('partial packet')) {
    return
  }
  originalConsoleError.apply(console, args)
}

function createBot() {
  console.log(`Starting bot ${username} -> ${host}:${port}`)
  const bot = mineflayer.createBot({ 
    host, 
    port, 
    username,
    hideErrors: true // Hide internal mineflayer errors
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(armorManager)

  // Combat settings
  let protecting = false
  let protectTarget = null
  let currentTarget = null
  let protectInterval = null
  let lastAttackTime = 0
  let lastCriticalTime = 0
  let strafeDirection = 1
  let lastStrafed = 0
  const PROTECT_RADIUS = 20
  const COMBAT_UPDATE_INTERVAL = 50 // Faster update rate for combat
  const CRITICAL_CHANCE = 0.8 // 80% chance for critical hits
  const STRAFE_RADIUS = 2.5 // Distance to maintain from target
  const ATTACK_COOLDOWN = 400 // ms between attacks (faster attacks)
  const COMBO_WINDOW = 2000 // ms window for combo attacks
  
  // Whitelist management
  let whitelist = []
  
  // Mining/Farming
  let isMining = false
  let miningInterval = null
  let targetBlock = null
  let targetAmount = 0
  let minedCount = 0
  
  // Combat stats
  let comboCount = 0
  let lastComboTime = 0

  function findBestSword() {
    const tiers = ['netherite', 'diamond', 'iron', 'stone', 'wooden']
    for (const t of tiers) {
      const item = bot.inventory.items().find(i => i.name === `${t}_sword`)
      if (item) return item
    }
    return bot.inventory.items().find(i => i.name.includes('sword'))
  }

  async function equipBestSword() {
    const sword = findBestSword()
    if (sword) {
      try {
        await bot.equip(sword, 'hand')
      } catch {}
    }
  }
  
  function findBow() {
    return bot.inventory.items().find(i => i.name === 'bow')
  }
  
  function hasArrows() {
    return bot.inventory.items().some(i => i.name === 'arrow')
  }
  
  async function equipBow() {
    const bow = findBow()
    if (bow) {
      try {
        await bot.equip(bow, 'hand')
        return true
      } catch {}
    }
    return false
  }
  
  let lastBowShot = 0
  let isShooting = false
  const BOW_COOLDOWN = 3000 // 3 seconds between bow shots
  
  function shootBow(target) {
    const now = Date.now()
    
    // Don't shoot if already shooting or on cooldown
    if (isShooting || now - lastBowShot < BOW_COOLDOWN) return
    
    if (!hasArrows()) {
      return
    }
    
    isShooting = true
    lastBowShot = now
    
    // Stop all movement first
    bot.clearControlStates()
    
    // Equip bow
    equipBow().then(() => {
      // Look at target
      const targetPos = target.position.offset(0, target.height * 0.5, 0)
      if (target.velocity) {
        targetPos.x += target.velocity.x * 2
        targetPos.z += target.velocity.z * 2
      }
      
      bot.lookAt(targetPos).catch(() => {})
      
      // Charge and shoot after a delay
      setTimeout(() => {
        bot.activateItem()
        
        // Hold for full charge (1 second)
        setTimeout(() => {
          bot.deactivateItem()
          console.log('🏹 Shot arrow')
          
          // Switch back to sword
          setTimeout(() => {
            equipBestSword()
            isShooting = false
          }, 200)
        }, 1000)
      }, 100)
    }).catch(() => {
      isShooting = false
    })
  }

  bot.once('spawn', () => {
    const mcData = minecraftData(bot.version)
    const move = new Movements(bot, mcData)
    bot.pathfinder.setMovements(move)
    console.log('✅ Bot joined the server!')
    

    
    // Equip any armor on spawn
    setTimeout(() => equipBestArmor(), 1000)
  })
  
  // Auto-equip armor when items are picked up or moved in inventory
  bot.on('playerCollect', () => {
    setTimeout(() => equipBestArmor(), 100)
  })
  
  bot.on('windowOpen', () => {
    setTimeout(() => equipBestArmor(), 500)
  })
  
  // Armor tier rankings (higher is better)
  const armorTiers = {
    'leather': 1,
    'golden': 2,
    'chainmail': 3,
    'iron': 4,
    'diamond': 5,
    'netherite': 6
  }
  
  function getArmorTier(itemName) {
    for (const [tier, value] of Object.entries(armorTiers)) {
      if (itemName.includes(tier)) return value
    }
    return 0
  }
  
  async function equipBestArmor() {
    const armorSlots = ['head', 'torso', 'legs', 'feet']
    const armorTypes = {
      'head': ['helmet', 'cap'],
      'torso': ['chestplate', 'tunic'],
      'legs': ['leggings', 'pants'],
      'feet': ['boots']
    }
    
    for (const slot of armorSlots) {
      try {
        // Get currently equipped armor
        const currentArmor = bot.inventory.slots[bot.getEquipmentDestSlot(slot)]
        const currentTier = currentArmor ? getArmorTier(currentArmor.name) : 0
        
        // Find best armor piece in inventory for this slot
        let bestArmor = null
        let bestTier = currentTier
        
        for (const item of bot.inventory.items()) {
          // Check if item is armor for this slot
          const isCorrectType = armorTypes[slot].some(type => item.name.includes(type))
          if (isCorrectType) {
            const tier = getArmorTier(item.name)
            if (tier > bestTier) {
              bestArmor = item
              bestTier = tier
            }
          }
        }
        
        // Equip better armor if found
        if (bestArmor && bestTier > currentTier) {
          console.log(`⚔️ Upgrading ${slot}: ${currentArmor?.name || 'none'} -> ${bestArmor.name}`)
          
          // Drop old armor if exists
          if (currentArmor) {
            await bot.unequip(slot)
            await bot.waitForTicks(5)
            try {
              await bot.toss(currentArmor.type, null, currentArmor.count)
              console.log(`📦 Dropped old ${currentArmor.name}`)
            } catch (e) {}
          }
          
          // Equip new armor
          await bot.equip(bestArmor, slot)
          await bot.waitForTicks(5)
          bot.chat(`✨ Equipped ${bestArmor.name}`)
        }
      } catch (err) {
        console.error(`Error equipping ${slot}:`, err.message)
      }
    }
  }

  // ===== Chat Commands =====
  // Handle commands from both chat and console
  function handleCommand(username, message) {
    const isConsole = username === 'CONSOLE'
    const player = isConsole ? bot.players[Object.keys(bot.players)[0]]?.entity : bot.players[username]?.entity
    if (!player && !isConsole) return
    
    // Check if message starts with command prefix
    if (!message.startsWith('.')) return
    
    const msg = message.toLowerCase().trim()
    const args = message.slice(1).split(' ') // Remove the . prefix
    
    // Log console commands
    if (isConsole) {
      console.log(`[CONSOLE] Executing command: ${message}`)
    }
    
    // Whitelist commands
    if (args[0].toLowerCase() === 'whitelist') {
      if (!args[1]) {
        bot.chat('❌ Usage: whitelist <add|remove|list|clear> [player]')
        return
      }
      
      const subCmd = args[1].toLowerCase()
      const targetName = args[2]
      
      switch (subCmd) {
        case 'add':
          if (!targetName) {
            bot.chat('❌ Please specify a player to whitelist')
            return
          }
          if (!whitelist.includes(targetName.toLowerCase())) {
            whitelist.push(targetName.toLowerCase())
            bot.chat(`✅ Added ${targetName} to whitelist`)
          } else {
            bot.chat(`ℹ️ ${targetName} is already whitelisted`)
          }
          break
          
        case 'remove':
          if (!targetName) {
            bot.chat('❌ Please specify a player to remove from whitelist')
            return
          }
          const index = whitelist.indexOf(targetName.toLowerCase())
          if (index > -1) {
            whitelist.splice(index, 1)
            bot.chat(`✅ Removed ${targetName} from whitelist`)
          } else {
            bot.chat(`❌ ${targetName} is not in the whitelist`)
          }
          break
          
        case 'list':
          if (whitelist.length === 0) {
            bot.chat('ℹ️ Whitelist is empty')
          } else {
            bot.chat(`📋 Whitelisted players: ${whitelist.join(', ')}`)
          }
          break
          
        case 'clear':
          whitelist = []
          bot.chat('✅ Cleared all players from whitelist')
          break
          
        default:
          bot.chat('❌ Unknown whitelist command. Use: add, remove, list, or clear')
      }
      return
    }

    if (args[0] === 'protect') {
      protecting = true
      protectTarget = player
      bot.chat(`🛡️ Protecting ${username}`)
      startProtection()
      return
    }
    
    if (args[0] === 'sentry') {
      // Stop other modes
      protecting = false
      hunting = false
      if (protectInterval) clearInterval(protectInterval)
      if (huntInterval) clearInterval(huntInterval)
      if (bot._followInterval) clearInterval(bot._followInterval)
      
      sentryMode = true
      sentryTarget = player
      bot.chat(`🛡️ Sentry mode - will retaliate if ${username} is hit`)
      startSentry(player)
      return
    }
    


    if (args[0] === 'stop') {
      bot.chat('🛑 Stopping all actions')
      protecting = false
      hunting = false
      sentryMode = false
      isMining = false
      protectTarget = null
      huntTarget = null
      sentryTarget = null
      currentTarget = null
      sentryHitsRemaining = 0
      bot.pathfinder.stop()
      if (miningInterval) clearInterval(miningInterval)
      if (bot._followInterval) clearInterval(bot._followInterval)
      if (huntInterval) clearInterval(huntInterval)
      if (sentryInterval) clearInterval(sentryInterval)
      if (sentryFollowInterval) clearInterval(sentryFollowInterval)
      bot.clearControlStates()
      return
    }
    
    if (args[0] === 'kill' && args[1]) {
      const targetPlayerName = args[1]
      const targetPlayer = Object.values(bot.players)
        .find(p => p.username.toLowerCase() === targetPlayerName.toLowerCase())
      
      if (!targetPlayer || !targetPlayer.entity) {
        bot.chat(`❌ Player ${targetPlayerName} not found`)
        return
      }
      
      // Stop protecting and start hunting
      protecting = false
      if (bot._followInterval) clearInterval(bot._followInterval)
      
      bot.chat(`💀 Hunting ${targetPlayer.username}`)
      startHunting(targetPlayer.entity)
      return
    }

    // Farm command: .farm [block] [amount]
    if (args[0] === 'farm' && args[1]) {
      const blockName = args[1]
      const amount = parseInt(args[2]) || 1
      bot.chat(`⛏️ Starting to farm ${amount} ${blockName}(s)`)
      mineBlock(blockName, amount)
      return
    }
    
    // Mine command (same as farm)
    if (args[0] === 'mine' && args[1]) {
      const blockName = args[1]
      const amount = parseInt(args[2]) || 1
      bot.chat(`⛏️ Starting to mine ${amount} ${blockName}(s)`)
      mineBlock(blockName, amount)
      return
    }
    
    // Craft command: .craft [item]
    if (args[0] === 'craft' && args[1]) {
      const itemName = args[1].toLowerCase()
      craftItem(itemName)
      return
    }
    
    // Drop command: .drop [item] [amount] [player]
    if (args[0] === 'drop' && args[1]) {
      const itemName = args[1].toLowerCase()
      const amount = parseInt(args[2]) || null
      const player = args[3] || null
      dropItems(itemName, amount, player)
      return
    }
    
    // Inventory command
    if (args[0] === 'inventory' || args[0] === 'inv') {
      const items = {}
      bot.inventory.items().forEach(item => {
        items[item.name] = (items[item.name] || 0) + item.count
      })
      
      if (Object.keys(items).length === 0) {
        bot.chat('🎒 Inventory is empty')
      } else {
        const invStr = Object.entries(items)
          .map(([name, count]) => `${name} (${count})`)
          .join(', ')
        bot.chat(`🎒 Inventory: ${invStr}`)
      }
      return
    }
    
    // Goto command: .goto [player]
    if (args[0] === 'goto' && args[1]) {
      const targetPlayerName = args[1]
      const targetPlayer = Object.values(bot.players)
        .find(p => p.username.toLowerCase() === targetPlayerName.toLowerCase())
      
      if (!targetPlayer || !targetPlayer.entity) {
        bot.chat(`❌ Player ${targetPlayerName} not found`)
        return
      }
      
      bot.chat(`🏃 Going to ${targetPlayer.username}`)
      
      const mcData = minecraftData(bot.version)
      const movements = new Movements(bot, mcData)
      movements.canDig = false
      movements.allowSprinting = true
      movements.allowParkour = true
      movements.allowFreeMotion = false // Don't swim
      movements.infiniteLiquidDropdownDistance = false // Don't drop into water
      
      const scaffoldBlocks = bot.inventory.items().filter(item => {
        return item.name.includes('dirt') || item.name.includes('cobblestone') || 
               item.name.includes('stone') || item.name.includes('netherrack') ||
               item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
      })
      
      if (scaffoldBlocks.length > 0) {
        movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
        movements.placeCost = 1 // Prefer placing blocks over swimming
      }
      
      bot.pathfinder.setMovements(movements)
      bot.pathfinder.goto(new goals.GoalNear(targetPlayer.entity.position.x, targetPlayer.entity.position.y, targetPlayer.entity.position.z, 2))
        .then(() => {
          bot.chat(`✅ Reached ${targetPlayer.username}`)
        })
        .catch(err => {
          console.log('Pathfinding error:', err.message)
          bot.chat(`❌ Could not reach ${targetPlayer.username}`)
        })
      return
    }

    if (args[0] === 'come') {
      protecting = false
      protectTarget = player
      bot.pathfinder.stop()
      
      // Clear any existing follow interval
      if (bot._followInterval) clearInterval(bot._followInterval)
      
      // Set up faster movement
      bot.setControlState('sprint', true)
      bot.setControlState('jump', false)
      
      if (!isConsole) bot.chat('🏃 Sprinting to you!')
      
      // Follow with optimized movement and logic
      let lastJump = 0
      let lastStuckCheck = Date.now()
      let lastStuckPos = bot.entity.position.clone()
      let isUsingPathfinder = false
      
      bot._followInterval = setInterval(() => {
        if (!protectTarget || (protectTarget.uuid && protectTarget.uuid !== player.uuid)) {
          clearInterval(bot._followInterval)
          return
        }
        
        const dist = bot.entity.position.distanceTo(player.position)
        const heightDiff = player.position.y - bot.entity.position.y
        const now = Date.now()
        
        // Check if stuck every 1.5 seconds
        if (now - lastStuckCheck > 1500) {
          const distMoved = bot.entity.position.distanceTo(lastStuckPos)
          
          // If stuck (moved less than 1 block in 1.5 seconds), use pathfinder
          if (distMoved < 1 && dist > 3 && !isUsingPathfinder) {
            console.log('🚧 Stuck! Using pathfinder...')
            isUsingPathfinder = true
            
            const mcData = minecraftData(bot.version)
            const movements = new Movements(bot, mcData)
            movements.canDig = false
            movements.allowSprinting = true
            movements.allowParkour = true
            movements.allowFreeMotion = false // Don't swim
            movements.infiniteLiquidDropdownDistance = false // Don't drop into water
            
            const scaffoldBlocks = bot.inventory.items().filter(item => {
              return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                     item.name.includes('stone') || item.name.includes('netherrack') ||
                     item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
            })
            
            if (scaffoldBlocks.length > 0) {
              movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
              movements.placeCost = 1 // Prefer placing blocks over swimming
            }
            
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.goto(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2))
              .catch(() => {})
              .finally(() => { isUsingPathfinder = false })
          }
          
          lastStuckPos = bot.entity.position.clone()
          lastStuckCheck = now
        }
        
        // Use pathfinder if there's a big height difference
        if (Math.abs(heightDiff) > 2.5 && dist > 3 && !isUsingPathfinder) {
          console.log('⛰️ Height difference detected, using pathfinder...')
          isUsingPathfinder = true
          
          const mcData = minecraftData(bot.version)
          const movements = new Movements(bot, mcData)
          movements.canDig = false
          movements.allowSprinting = true
          movements.allowParkour = true
          movements.allowFreeMotion = false // Don't swim
          movements.infiniteLiquidDropdownDistance = false // Don't drop into water
          
          const scaffoldBlocks = bot.inventory.items().filter(item => {
            return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                   item.name.includes('stone') || item.name.includes('netherrack') ||
                   item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
          })
          
          if (scaffoldBlocks.length > 0) {
            movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
            movements.placeCost = 1 // Prefer placing blocks over swimming
          }
          
          bot.pathfinder.setMovements(movements)
          bot.pathfinder.goto(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2))
            .catch(() => {})
            .finally(() => { isUsingPathfinder = false })
        }
        
        if (dist > 3 && !isUsingPathfinder) {
          // Manual sprint jumping for speed
          bot.clearControlStates()
          
          // Look at target
          try {
            bot.lookAt(player.position.offset(0, player.height, 0))
          } catch (e) {}
          
          // Always move forward
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
          
          // Optimized jumping - jump more frequently and reliably
          if (bot.entity.onGround && now - lastJump > 300) {
            bot.setControlState('jump', true)
            setTimeout(() => {
              bot.setControlState('jump', false)
              lastJump = Date.now()
            }, 100)
          }
          
          // Strafe slightly for better pathfinding around obstacles
          if (Math.random() > 0.8) {
            bot.setControlState('left', true)
            setTimeout(() => bot.setControlState('left', false), 100)
          } else if (Math.random() > 0.9) {
            bot.setControlState('right', true)
            setTimeout(() => bot.setControlState('right', false), 100)
          }
        } else if (dist <= 3) {
          // Close enough - stop
          if (isUsingPathfinder) {
            bot.pathfinder.stop()
            isUsingPathfinder = false
          }
          bot.clearControlStates()
        }
      }, 50) // Faster update interval
    }
  }
  
  // Handle chat messages
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    handleCommand(username, message)
  })
  
  // Set up console input
  const readline = require('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  rl.on('line', (input) => {
    if (input.trim()) {
      handleCommand('CONSOLE', input)
    }
  })
  
  console.log('✅ Console commands enabled! Type your commands below:')

  // ===== Utility Functions =====
  async function findAndEquipBestTool(blockName) {
    const tools = {
      'pickaxe': ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe', 'golden_pickaxe'],
      'axe': ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe', 'golden_axe'],
      'shovel': ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel', 'golden_shovel']
    }
    
    // Determine best tool type for the block
    let toolType = 'shovel' // Default for dirt
    if (blockName.includes('log') || blockName.includes('wood') || blockName.includes('plank')) {
      toolType = 'axe'
    } else if (blockName.includes('stone') || blockName.includes('ore') || blockName.includes('cobblestone')) {
      toolType = 'pickaxe'
    } else if (blockName.includes('dirt') || blockName.includes('sand') || blockName.includes('gravel') || blockName.includes('grass')) {
      toolType = 'shovel'
    }
    
    console.log(`Looking for ${toolType} to mine ${blockName}`)
    
    // Find best available tool
    for (const tool of tools[toolType]) {
      const item = bot.inventory.items().find(i => i.name === tool)
      if (item) {
        await bot.equip(item, 'hand')
        console.log(`Equipped ${tool}`)
        await bot.waitForTicks(5) // Wait for equip to register
        return true
      }
    }
    
    console.log(`No ${toolType} found, mining with hand`)
    return false
  }
  
  async function craftItem(itemName) {
    const recipes = {
      'wooden_sword': { id: 268, requires: [{id: 5, count: 2}, {id: 280, count: 1}] },
      'stone_sword': { id: 272, requires: [{id: 4, count: 2}, {id: 280, count: 1}] },
      'iron_sword': { id: 267, requires: [{id: 265, count: 2}, {id: 280, count: 1}] },
      'diamond_sword': { id: 276, requires: [{id: 264, count: 2}, {id: 280, count: 1}] },
      'wooden_pickaxe': { id: 270, requires: [{id: 5, count: 3}, {id: 280, count: 2}] },
      'stone_pickaxe': { id: 274, requires: [{id: 4, count: 3}, {id: 280, count: 2}] },
      'iron_pickaxe': { id: 257, requires: [{id: 265, count: 3}, {id: 280, count: 2}] },
      'diamond_pickaxe': { id: 278, requires: [{id: 264, count: 3}, {id: 280, count: 2}] }
    }
    
    const recipe = recipes[itemName]
    if (!recipe) {
      bot.chat(`❌ I don't know how to craft ${itemName}`)
      return false
    }
    
    // Check if we have the required items
    for (const req of recipe.requires) {
      const hasItem = bot.inventory.items().some(i => i.type === req.id && i.count >= req.count)
      if (!hasItem) {
        bot.chat(`❌ Need more materials to craft ${itemName}`)
        return false
      }
    }
    
    // Craft the item
    try {
      const craftingTable = bot.findBlock({
        matching: 58, // Crafting table ID
        maxDistance: 5
      })
      
      if (craftingTable) {
        await bot.lookAt(craftingTable.position.offset(0.5, 0.5, 0.5))
        await bot.activateBlock(craftingTable)
      }
      
      const item = bot.registry.itemsByName[itemName]
      await bot.craft(item, null, null)
      bot.chat(`✅ Crafted ${itemName}`)
      return true
    } catch (err) {
      bot.chat(`❌ Failed to craft ${itemName}: ${err.message}`)
      return false
    }
  }
  
  async function dropItems(itemName, amount = null, toPlayer = null) {
    const items = bot.inventory.items()
      .filter(i => i.name.includes(itemName.toLowerCase()))
      .sort((a, b) => b.count - a.count)
    
    if (items.length === 0) {
      bot.chat(`❌ No ${itemName} found in inventory`)
      return false
    }
    
    let remaining = amount || items.reduce((sum, i) => sum + i.count, 0)
    
    for (const item of items) {
      if (remaining <= 0) break
      const dropCount = Math.min(remaining, item.count)
      try {
        if (toPlayer) {
          // Find the player to drop items to
          const player = Object.values(bot.players)
            .find(p => p.username.toLowerCase() === toPlayer.toLowerCase())
          
          if (player && player.entity) {
            // Move to the player
            const startPos = bot.entity.position.clone()
            await bot.pathfinder.goto(new goals.GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 2))
            
            // Drop items
            await bot.toss(item.type, null, dropCount)
            bot.chat(`📦 Dropped ${dropCount}x ${itemName} to ${player.username}`)
            
            // Return to original position if needed
            await bot.pathfinder.goto(new goals.GoalNear(startPos.x, startPos.y, startPos.z, 1))
          } else {
            bot.chat(`❌ Player ${toPlayer} not found`)
            return false
          }
        } else {
          // Just drop items on the ground
          await bot.toss(item.type, null, dropCount)
          bot.chat(`📦 Dropped ${dropCount}x ${itemName}`)
        }
        remaining -= dropCount
      } catch (err) {
        bot.chat(`❌ Failed to drop items: ${err.message}`)
        return false
      }
    }
    
    return true
  }
  
  async function mineBlock(blockName, amount = 1) {
    isMining = true
    minedCount = 0
    targetAmount = amount
    
    // Find the block type
    const blockType = Object.entries(bot.registry.blocksByName)
      .find(([name]) => name.includes(blockName.toLowerCase()))?.[1]?.id
    
    if (!blockType) {
      bot.chat(`❌ Unknown block: ${blockName}`)
      isMining = false
      return
    }
    
    // Equip best tool for the job
    await findAndEquipBestTool(blockName)
    
    // Start mining
    const mineNextBlock = async () => {
      if (minedCount >= targetAmount || !isMining) {
        clearInterval(miningInterval)
        isMining = false
        bot.pathfinder.stop()
        bot.chat(`✅ Finished mining ${minedCount} ${blockName}(s)`)
        return
      }
      
      try {
        // Find nearest block
        const block = bot.findBlock({
          matching: blockType,
          maxDistance: 16,
          count: 1,
          useExtraInfo: false
        })
        
        if (block) {
          // Equip tool again before each block
          await findAndEquipBestTool(blockName)
          
          // Move to block
          await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3))
          
          // Stop pathfinding
          bot.pathfinder.stop()
          
          // Look at block
          await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true)
          
          // Make sure we're close enough
          const distance = bot.entity.position.distanceTo(block.position)
          if (distance > 4.5) {
            bot.chat('❌ Too far from the block')
            return
          }
          
          // Break the block
          try {
            console.log(`Attempting to dig ${blockName} at ${block.position}`)
            
            // Check if block still exists before digging
            const blockAtPos = bot.blockAt(block.position)
            if (!blockAtPos || blockAtPos.type === 0) {
              console.log('Block already broken or air')
              return
            }
            
            console.log(`Block type: ${blockAtPos.name}, Tool in hand: ${bot.heldItem?.name || 'none'}`)
            
            // Dig the block and wait for it to complete
            await bot.dig(block, true)
            
            // Wait for server to register the break
            await bot.waitForTicks(20)
            
            const blockAfter = bot.blockAt(block.position)
            if (!blockAfter || blockAfter.type === 0) {
              minedCount++
              bot.chat(`⛏️ Mined ${minedCount}/${targetAmount} ${blockName}(s)`)
            } else {
              console.log(`⚠️ Block did not break - Block after: ${blockAfter.name}`)
              bot.chat('⚠️ Cannot break blocks here - protected area or no permission')
              isMining = false
              clearInterval(miningInterval)
              return
            }
          } catch (digErr) {
            console.error('Digging error:', digErr.message)
            bot.chat(`❌ Mining error: ${digErr.message}`)
            // Continue to next block if we can't break this one
          }
        } else {
          bot.chat(`❌ No ${blockName} found nearby`)
          clearInterval(miningInterval)
          isMining = false
        }
      } catch (err) {
        console.error('Mining error:', err)
        // Continue to next block on error
      }
    }
    
    // Clear any existing interval
    if (miningInterval) clearInterval(miningInterval)
    
    // Start mining with a small delay between blocks
    mineNextBlock()
    miningInterval = setInterval(mineNextBlock, 1000)
  }

  // ===== Combat Utilities =====
  function shouldCritical() {
    // Higher chance for critical hits as combo increases
    const comboBonus = Math.min(comboCount * 0.05, 0.3) // Up to 30% bonus from combo
    const baseChance = CRITICAL_CHANCE + comboBonus
    return Math.random() < baseChance
  }

  function updateCombo() {
    const now = Date.now()
    if (now - lastComboTime > COMBO_WINDOW) {
      comboCount = 1
    } else {
      comboCount++
    }
    lastComboTime = now
  }

  function getOptimalAttackDistance() {
    return 2.5 + (Math.random() * 0.5) // Randomize distance slightly
  }

  function performCritical() {
    if (bot.entity.onGround) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', true)
      setTimeout(() => {
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
      }, 150)
      lastCriticalTime = Date.now()
      return true
    }
    return false
  }

  function strafe() {
    const now = Date.now()
    if (now - lastStrafed > 1000) { // Change strafe direction every second
      strafeDirection *= -1
      lastStrafed = now
    }
    
    bot.clearControlStates()
    if (Math.random() > 0.3) { // 70% chance to strafe
      const side = strafeDirection > 0 ? 'left' : 'right'
      bot.setControlState(side, true)
    }
    
    // Randomly move forward or backward
    if (Math.random() > 0.7) {
      bot.setControlState('forward', true)
    } else if (Math.random() > 0.8) {
      bot.setControlState('back', true)
    }
  }

  // ===== Sentry Logic =====
  let sentryMode = false
  let sentryTarget = null
  let sentryHitsRemaining = 0
  let sentryInterval = null
  let sentryFollowInterval = null
  
  function startSentry(player) {
    sentryMode = true
    sentryTarget = player
    console.log(`🛡️ Sentry mode activated - protecting ${player.username}`)
    
    // Start following the sentry target
    if (sentryFollowInterval) clearInterval(sentryFollowInterval)
    
    let lastFollowJump = 0
    let isPathfinding = false
    
    sentryFollowInterval = setInterval(() => {
      // Safety check
      if (!bot || !bot.entity || !bot.entity.position) return
      
      if (!sentryMode || !sentryTarget || !sentryTarget.position) {
        clearInterval(sentryFollowInterval)
        bot.clearControlStates()
        return
      }
      
      // Don't follow if currently retaliating
      if (sentryInterval) {
        bot.clearControlStates()
        return
      }
      
      // Check if bot is in water and try to get out
      if (bot.entity.isInWater) {
        console.log('💧 In water! Trying to get out...')
        bot.setControlState('jump', true)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0))
        if (blockBelow && blockBelow.name === 'water') {
          const scaffoldBlocks = bot.inventory.items().filter(item => {
            return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                   item.name.includes('stone') || item.name.includes('netherrack') ||
                   item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
          })
          
          if (scaffoldBlocks.length > 0) {
            try {
              bot.equip(scaffoldBlocks[0], 'hand')
              bot.placeBlock(blockBelow, new bot.Vec3(0, 1, 0))
            } catch (e) {}
          }
        }
        return
      }
      
      const dist = bot.entity.position.distanceTo(sentryTarget.position)
      const heightDiff = sentryTarget.position.y - bot.entity.position.y
      const now = Date.now()
      
      if (dist > 5) {
        // Use pathfinder if there's a big height difference
        if (Math.abs(heightDiff) > 2.5 && !isPathfinding) {
          isPathfinding = true
          
          const mcData = minecraftData(bot.version)
          const movements = new Movements(bot, mcData)
          movements.canDig = false
          movements.allowSprinting = true
          movements.allowParkour = true
          movements.allowFreeMotion = false
          movements.infiniteLiquidDropdownDistance = false
          
          const scaffoldBlocks = bot.inventory.items().filter(item => {
            return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                   item.name.includes('stone') || item.name.includes('netherrack') ||
                   item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
          })
          
          if (scaffoldBlocks.length > 0) {
            movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
            movements.placeCost = 1
          }
          
          bot.pathfinder.setMovements(movements)
          bot.pathfinder.goto(new goals.GoalNear(sentryTarget.position.x, sentryTarget.position.y, sentryTarget.position.z, 4))
            .catch(() => {})
            .finally(() => { isPathfinding = false })
        } else if (!isPathfinding) {
          // Manual sprint jumping for speed
          bot.clearControlStates()
          
          try {
            bot.lookAt(sentryTarget.position.offset(0, sentryTarget.height * 0.5, 0))
          } catch (e) {}
          
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
          
          // Sprint jump constantly for maximum speed
          if (bot.entity.onGround && now - lastFollowJump > 300) {
            bot.setControlState('jump', true)
            setTimeout(() => bot.setControlState('jump', false), 100)
            lastFollowJump = now
          }
        }
      } else {
        // Close enough - stop
        if (isPathfinding) {
          bot.pathfinder.stop()
          isPathfinding = false
        }
        bot.clearControlStates()
      }
    }, COMBAT_UPDATE_INTERVAL)
  }
  
  function retaliate(attacker) {
    if (!sentryMode) return
    
    console.log(`⚔️ Retaliating against ${attacker.username || attacker.displayName || 'attacker'}`)
    sentryHitsRemaining = 5
    
    if (sentryInterval) clearInterval(sentryInterval)
    
    sentryInterval = setInterval(() => {
      // Safety check
      if (!bot || !bot.entity || !bot.entity.position) {
        clearInterval(sentryInterval)
        sentryInterval = null
        return
      }
      
      if (sentryHitsRemaining <= 0 || !attacker || !attacker.position) {
        clearInterval(sentryInterval)
        sentryInterval = null
        bot.clearControlStates()
        
        // Return to sentry target - the follow interval will handle it
        console.log('✅ Retaliation complete, returning to sentry target')
        return
      }
      
      // Attack the attacker
      const dist = bot.entity.position.distanceTo(attacker.position)
      
      if (dist < 4.5) {
        equipBestSword().catch(() => {})
        
        // Look at attacker
        try {
          bot.lookAt(attacker.position.offset(0, attacker.height * 0.5, 0))
        } catch (e) {}
        
        // Critical hit
        if (bot.entity.onGround) {
          bot.setControlState('jump', true)
          bot.setControlState('sprint', true)
          
          setTimeout(() => {
            bot.attack(attacker)
            sentryHitsRemaining--
            console.log(`💥 Hit! ${sentryHitsRemaining} hits remaining`)
            bot.setControlState('jump', false)
          }, 100)
        } else {
          bot.attack(attacker)
          sentryHitsRemaining--
          console.log(`💥 Hit! ${sentryHitsRemaining} hits remaining`)
        }
      } else {
        // Move towards attacker
        bot.clearControlStates()
        try {
          bot.lookAt(attacker.position.offset(0, attacker.height * 0.5, 0))
        } catch (e) {}
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        
        if (bot.entity.onGround) {
          bot.setControlState('jump', true)
          setTimeout(() => bot.setControlState('jump', false), 100)
        }
      }
    }, 500) // Attack every 0.5 seconds
  }

  // ===== Hunting Logic =====
  let hunting = false
  let huntTarget = null
  let huntInterval = null
  
  function startHunting(target) {
    hunting = true
    huntTarget = target
    
    if (huntInterval) clearInterval(huntInterval)
    
    huntInterval = setInterval(() => {
      // Safety check
      if (!bot || !bot.entity || !bot.entity.position) {
        clearInterval(huntInterval)
        return
      }
      
      if (!hunting || !huntTarget) {
        clearInterval(huntInterval)
        bot.clearControlStates()
        return
      }
      
      // Check if target still exists and is alive
      const targetPlayer = Object.values(bot.players)
        .find(p => p.entity && p.entity === huntTarget)
      
      if (!targetPlayer || !targetPlayer.entity) {
        bot.chat(`✅ Target lost or eliminated`)
        hunting = false
        clearInterval(huntInterval)
        bot.clearControlStates()
        return
      }
      
      // Check if bot is in water and try to get out
      if (bot.entity.isInWater) {
        console.log('💧 In water! Trying to get out...')
        bot.setControlState('jump', true)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0))
        if (blockBelow && blockBelow.name === 'water') {
          const scaffoldBlocks = bot.inventory.items().filter(item => {
            return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                   item.name.includes('stone') || item.name.includes('netherrack') ||
                   item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
          })
          
          if (scaffoldBlocks.length > 0) {
            try {
              bot.equip(scaffoldBlocks[0], 'hand')
              bot.placeBlock(blockBelow, new bot.Vec3(0, 1, 0))
            } catch (e) {}
          }
        }
        return
      }
      
      // Attack the target
      attackMob(huntTarget)
    }, COMBAT_UPDATE_INTERVAL)
  }

  // ===== Protection Logic =====
  function attackMob(target) {
    if (!target || !target.position) return
    
    const now = Date.now()
    const dist = bot.entity.position.distanceTo(target.position)
    const heightDiff = target.position.y - bot.entity.position.y
    
    // Bow disabled - causes invalid movement kicks
    // TODO: Fix bow mechanics to work with server movement validation
    // if (dist > 10 && dist < 30 && findBow() && hasArrows() && bot.entity.onGround && !isShooting) {
    //   shootBow(target)
    //   return
    // }
    
    equipBestSword().catch(() => {})
    
    // Initialize stuck detection for combat
    if (!bot._lastCombatPos) bot._lastCombatPos = bot.entity.position.clone()
    if (!bot._lastCombatCheck) bot._lastCombatCheck = now
    if (!bot._combatPathfinding) bot._combatPathfinding = false
    
    // Check if stuck during combat every 2 seconds
    if (now - bot._lastCombatCheck > 2000) {
      const distMoved = bot.entity.position.distanceTo(bot._lastCombatPos)
      bot._lastCombatPos = bot.entity.position.clone()
      bot._lastCombatCheck = now
      
      // If stuck (moved less than 1 block in 2 seconds) and target is far, use pathfinder
      if (distMoved < 1 && dist > 4 && !bot._combatPathfinding) {
        console.log('🚧 Stuck in combat! Using pathfinder...')
        bot._combatPathfinding = true
        
        const mcData = minecraftData(bot.version)
        const movements = new Movements(bot, mcData)
        movements.canDig = false
        movements.allowSprinting = true
        movements.allowParkour = true
        movements.allowFreeMotion = false
        movements.infiniteLiquidDropdownDistance = false
        
        const scaffoldBlocks = bot.inventory.items().filter(item => {
          return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                 item.name.includes('stone') || item.name.includes('netherrack') ||
                 item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
        })
        
        if (scaffoldBlocks.length > 0) {
          movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
          movements.placeCost = 1
        }
        
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3))
          .catch(() => {})
          .finally(() => { 
            bot._combatPathfinding = false
            bot._lastCombatPos = bot.entity.position.clone()
          })
      }
    }
    
    // Use pathfinder if there's a big height difference
    if (Math.abs(heightDiff) > 2.5 && dist > 4 && !bot._combatPathfinding) {
      console.log('⛰️ Height difference in combat, using pathfinder...')
      bot._combatPathfinding = true
      
      const mcData = minecraftData(bot.version)
      const movements = new Movements(bot, mcData)
      movements.canDig = false
      movements.allowSprinting = true
      movements.allowParkour = true
      movements.allowFreeMotion = false
      movements.infiniteLiquidDropdownDistance = false
      
      const scaffoldBlocks = bot.inventory.items().filter(item => {
        return item.name.includes('dirt') || item.name.includes('cobblestone') || 
               item.name.includes('stone') || item.name.includes('netherrack') ||
               item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
      })
      
      if (scaffoldBlocks.length > 0) {
        movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
        movements.placeCost = 1
      }
      
      bot.pathfinder.setMovements(movements)
      bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3))
        .catch(() => {})
        .finally(() => { bot._combatPathfinding = false })
    }
    
    // Only use manual movement if not pathfinding
    if (!bot._combatPathfinding) {
      // Look at target
      try {
        const targetHeight = target.height || 1.8
        bot.lookAt(target.position.offset(0, targetHeight * 0.5, 0))
      } catch (e) {
        // Ignore look errors
      }
      
      // Clear previous states
      bot.clearControlStates()
      
      // Change strafe direction periodically
      if (now - lastStrafed > 600) {
        strafeDirection *= -1
        lastStrafed = now
      }
      
      const optimalDist = 3.2 // Optimal attack distance
      
      // Movement logic
      if (dist > 5) {
        // Too far - sprint towards target with jumps
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        
        if (bot.entity.onGround) {
          bot.setControlState('jump', true)
          setTimeout(() => bot.setControlState('jump', false), 100)
        }
      } else if (dist > optimalDist + 0.5) {
        // Getting close - move forward while strafing
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        
        const side = strafeDirection > 0 ? 'left' : 'right'
        bot.setControlState(side, true)
      } else if (dist < optimalDist - 0.8) {
        // Too close - back up while strafing
        bot.setControlState('back', true)
        
        const side = strafeDirection > 0 ? 'left' : 'right'
        bot.setControlState(side, true)
      } else {
        // Perfect distance - circle strafe around target
        const side = strafeDirection > 0 ? 'left' : 'right'
        bot.setControlState(side, true)
        bot.setControlState('sprint', true)
        
        // Occasionally move forward/back to adjust distance
        if (Math.random() > 0.7) {
          bot.setControlState('forward', true)
        } else if (Math.random() > 0.85) {
          bot.setControlState('back', true)
        }
      }
    }
    
    // Attack with ALWAYS critical hits
    if (now - lastAttackTime > ATTACK_COOLDOWN && dist < 4.2) {
      // Check if we're falling (for critical hit)
      const isFalling = bot.entity.velocity.y < -0.08
      
      if (isFalling) {
        // We're falling - ATTACK NOW for critical hit!
        bot.attack(target)
        updateCombo()
        lastAttackTime = now
        console.log(`⚔️ CRIT! ${target.name || target.displayName || target.username || 'entity'} at ${dist.toFixed(1)}m (Combo: ${comboCount})`)
      } else if (bot.entity.onGround) {
        // On ground - jump to prepare for critical
        bot.setControlState('jump', true)
        bot.setControlState('sprint', true)
        
        // Release jump quickly
        setTimeout(() => {
          bot.setControlState('jump', false)
        }, 50)
        
        // Don't update lastAttackTime yet - wait for the falling attack
      } else {
        // In air but not falling fast enough yet - wait
        // Don't attack, don't update cooldown
      }
    }
  }

  function startProtection() {
    if (protectInterval) clearInterval(protectInterval)
    
    let isPathfinding = false
    let lastFollowJump = 0
    let debugCounter = 0
    
    protectInterval = setInterval(() => {
      // Safety check
      if (!bot || !bot.entity || !bot.entity.position) {
        clearInterval(protectInterval)
        return
      }
      
      if (!protecting || !protectTarget) {
        clearInterval(protectInterval)
        bot.clearControlStates()
        return
      }
      
      // Check if bot is in water and try to get out
      if (bot.entity.isInWater) {
        console.log('💧 In water! Trying to get out...')
        bot.setControlState('jump', true)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        
        // Try to place blocks under to get out
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0))
        if (blockBelow && blockBelow.name === 'water') {
          const scaffoldBlocks = bot.inventory.items().filter(item => {
            return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                   item.name.includes('stone') || item.name.includes('netherrack') ||
                   item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
          })
          
          if (scaffoldBlocks.length > 0) {
            try {
              bot.equip(scaffoldBlocks[0], 'hand')
              bot.placeBlock(blockBelow, new bot.Vec3(0, 1, 0))
            } catch (e) {}
          }
        }
        return
      }
      
      // Debug: List all nearby entities every 10 seconds (reduced frequency)
      debugCounter++
      if (debugCounter % 200 === 0) {
        const nearbyEntities = Object.values(bot.entities).filter(e => {
          return e && e.position && e.position.distanceTo(bot.entity.position) < PROTECT_RADIUS
        })
        console.log(`\n📍 Nearby entities (${nearbyEntities.length}):`)
        nearbyEntities.slice(0, 10).forEach(e => { // Only show first 10
          const dist = e.position.distanceTo(bot.entity.position).toFixed(1)
          console.log(`  - ${e.name || e.username || e.displayName || 'unknown'} | Type: ${e.type} | Dist: ${dist}m`)
        })
      }
      
      // Find nearest entity (attack everything except whitelisted players and self)
      const target = bot.nearestEntity(e => {
        if (!e || !e.position) return false
        
        const dist = e.position.distanceTo(protectTarget.position)
        if (dist > PROTECT_RADIUS) return false
        
        // Don't attack the protect target
        if (protectTarget.username && e.username === protectTarget.username) return false
        
        // Don't attack self
        if (e.username === bot.username) return false
        
        // Don't attack whitelisted players
        if (e.type === 'player' && e.username && whitelist.includes(e.username.toLowerCase())) {
          return false
        }
        
        // Don't attack dropped items, experience orbs, arrows, etc.
        if (e.type === 'other' || e.type === 'orb' || e.name === 'item' || e.name === 'arrow' || 
            e.name === 'experience_orb' || e.name === 'item_frame' || e.name === 'painting') {
          return false
        }
        
        // Attack EVERYTHING else (mobs, players, animals, hostile mobs, etc.)
        // Reduced logging to prevent memory buildup
        return true
      })
      
      if (target) {
        currentTarget = target
        isPathfinding = false
        bot.pathfinder.stop()
        attackMob(target)
      } else {
        currentTarget = null
        // No threats, follow the protect target with smart logic
        const dist = bot.entity.position.distanceTo(protectTarget.position)
        const heightDiff = protectTarget.position.y - bot.entity.position.y
        const now = Date.now()
        
        // Initialize stuck detection
        if (!bot._lastFollowPos) bot._lastFollowPos = bot.entity.position.clone()
        if (!bot._lastFollowCheck) bot._lastFollowCheck = now
        
        // Check if stuck every 1.5 seconds
        if (now - bot._lastFollowCheck > 1500) {
          const distMoved = bot.entity.position.distanceTo(bot._lastFollowPos)
          bot._lastFollowPos = bot.entity.position.clone()
          bot._lastFollowCheck = now
          
          // If stuck (moved less than 1 block in 1.5 seconds), use pathfinder
          if (distMoved < 1 && dist > 5 && !isPathfinding) {
            console.log('🚧 Stuck! Using pathfinder...')
            isPathfinding = true
            
            const mcData = minecraftData(bot.version)
            const movements = new Movements(bot, mcData)
            movements.canDig = false
            movements.allowSprinting = true
            movements.allowParkour = true
            movements.allowFreeMotion = false
            movements.infiniteLiquidDropdownDistance = false
            
            const scaffoldBlocks = bot.inventory.items().filter(item => {
              return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                     item.name.includes('stone') || item.name.includes('netherrack') ||
                     item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
            })
            
            if (scaffoldBlocks.length > 0) {
              movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
              movements.placeCost = 1
            }
            
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.goto(new goals.GoalNear(protectTarget.position.x, protectTarget.position.y, protectTarget.position.z, 4))
              .catch(() => {})
              .finally(() => { isPathfinding = false })
          }
        }
        
        if (dist > 5) {
          // Use pathfinder if there's a big height difference
          if (Math.abs(heightDiff) > 2.5 && !isPathfinding) {
            isPathfinding = true
            
            const mcData = minecraftData(bot.version)
            const movements = new Movements(bot, mcData)
            movements.canDig = false
            movements.allowSprinting = true
            movements.allowParkour = true
            movements.allowFreeMotion = false
            movements.infiniteLiquidDropdownDistance = false
            
            const scaffoldBlocks = bot.inventory.items().filter(item => {
              return item.name.includes('dirt') || item.name.includes('cobblestone') || 
                     item.name.includes('stone') || item.name.includes('netherrack') ||
                     item.name.includes('planks') || item.name === 'sand' || item.name === 'gravel'
            })
            
            if (scaffoldBlocks.length > 0) {
              movements.scaffoldingBlocks = scaffoldBlocks.map(item => bot.registry.itemsByName[item.name].id)
              movements.placeCost = 1
            }
            
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.goto(new goals.GoalNear(protectTarget.position.x, protectTarget.position.y, protectTarget.position.z, 4))
              .catch(() => {})
              .finally(() => { isPathfinding = false })
          } else if (!isPathfinding) {
            // Manual sprint jumping for speed
            bot.clearControlStates()
            
            try {
              bot.lookAt(protectTarget.position.offset(0, protectTarget.height * 0.5, 0))
            } catch (e) {}
            
            bot.setControlState('forward', true)
            bot.setControlState('sprint', true)
            
            // Sprint jump constantly for maximum speed
            if (bot.entity.onGround && now - lastFollowJump > 300) {
              bot.setControlState('jump', true)
              setTimeout(() => bot.setControlState('jump', false), 100)
              lastFollowJump = now
            }
          }
        } else {
          // Close enough - stop and stay at comfortable distance
          if (isPathfinding) {
            bot.pathfinder.stop()
            isPathfinding = false
          }
          bot.clearControlStates()
        }
      }
    }, COMBAT_UPDATE_INTERVAL)
  }

  bot.on('death', () => {
    console.log('💀 Bot died — stopping all actions.')
    protecting = false
    hunting = false
    sentryMode = false
    currentTarget = null
    huntTarget = null
    sentryTarget = null
    sentryHitsRemaining = 0
    comboCount = 0
    clearInterval(protectInterval)
    if (huntInterval) clearInterval(huntInterval)
    if (sentryInterval) clearInterval(sentryInterval)
    if (sentryFollowInterval) clearInterval(sentryFollowInterval)
    if (bot._followInterval) clearInterval(bot._followInterval)
    if (miningInterval) clearInterval(miningInterval)
    bot.clearControlStates()
  })

  bot.on('end', (reason) => {
    console.log('❌ Disconnected:', reason)
    if (bot._followInterval) clearInterval(bot._followInterval)
    if (protectInterval) clearInterval(protectInterval)
    if (huntInterval) clearInterval(huntInterval)
    if (sentryInterval) clearInterval(sentryInterval)
    if (sentryFollowInterval) clearInterval(sentryFollowInterval)
    if (miningInterval) clearInterval(miningInterval)
    bot.clearControlStates()
    setTimeout(createBot, 8000)
  })

  bot.on('error', (err) => {
    console.log('⚠️ Error:', err.message)
    // Don't crash on errors, just log them
    
    // If it's a packet error, ignore it
    if (err.message.includes('Chunk size') || err.message.includes('partial packet')) {
      console.log('⚠️ Ignoring packet parsing error')
      return
    }
  })
  
  bot.on('kicked', (reason) => {
    console.log('⚠️ Kicked from server:', reason)
    setTimeout(createBot, 8000)
  })
  
  // Handle explosions without crashing
  bot.on('explosion', (explosion) => {
    try {
      console.log('💥 Explosion detected!')
      // Bot will handle damage automatically
    } catch (err) {
      console.error('Error handling explosion:', err.message)
    }
  })
  
  // Catch packet errors from mineflayer's protocol
  bot._client.on('error', (err) => {
    console.log('⚠️ Client error:', err.message)
    // Ignore packet parsing errors
    if (err.message.includes('Chunk size') || err.message.includes('partial packet')) {
      console.log('⚠️ Ignoring malformed packet')
      return
    }
  })
  
  // Handle entity damage without crashing
  bot.on('entityHurt', (entity) => {
    // Ignore if bot is not ready
    if (!bot || !bot.entity || !bot.entity.position) return
    
    // Wrap everything in try-catch to prevent crashes
    try {
      // Additional safety check
      if (!entity || !entity.position) return
      
      // Bot got hit - always retaliate with one crit
      if (entity === bot.entity) {
        console.log(`💔 Bot took damage! Health: ${bot.health.toFixed(1)}`)
        
        // Check if bot has extreme velocity (mace hit) - if so, just recover
        if (bot.entity.velocity && (Math.abs(bot.entity.velocity.y) > 2 || Math.abs(bot.entity.velocity.x) > 1 || Math.abs(bot.entity.velocity.z) > 1)) {
          console.log('💥 Extreme knockback detected! Recovering...')
          // Clear all states and let physics settle
          bot.clearControlStates()
          return
        }
        
        // Only retaliate if we can find an attacker
        try {
          const attacker = bot.nearestEntity(e => {
            if (!e || !e.position) return false
            
            try {
              const dist = e.position.distanceTo(bot.entity.position)
              
              // Check if it's a player or mob
              if ((e.type === 'player' || e.type === 'mob' || e.type === 'hostile') && e.username !== bot.username) {
                // Don't attack protect target or sentry target
                if (protectTarget && e.username === protectTarget.username) return false
                if (sentryTarget && e.username === sentryTarget.username) return false
                
                // Must be close enough to have hit us
                if (dist < 6) {
                  return true
                }
              }
            } catch (e) {
              return false
            }
            
            return false
          })
          
          if (attacker && attacker.position) {
            const attackerName = attacker.username || attacker.displayName || attacker.name || 'entity'
            console.log(`⚔️ Retaliating against ${attackerName}`)
            
            // Quick retaliation - one crit
            equipBestSword().then(() => {
              if (!attacker || !attacker.position) return
              
              try {
                const dist = bot.entity.position.distanceTo(attacker.position)
                
                if (dist < 4.5) {
                  // Look at attacker
                  try {
                    bot.lookAt(attacker.position.offset(0, attacker.height * 0.5, 0))
                  } catch (e) {}
                  
                  // Critical hit
                  if (bot.entity.onGround) {
                    bot.setControlState('jump', true)
                    bot.setControlState('sprint', true)
                    
                    setTimeout(() => {
                      if (attacker && attacker.position) {
                        bot.attack(attacker)
                      }
                      bot.setControlState('jump', false)
                      console.log(`💥 Retaliation crit!`)
                    }, 100)
                  } else {
                    bot.attack(attacker)
                    console.log(`💥 Retaliation hit!`)
                  }
                }
              } catch (e) {
                console.log('⚠️ Could not retaliate - attacker out of range')
              }
            }).catch(() => {})
          } else {
            console.log('⚠️ Took damage but no attacker found (explosion/fall/etc)')
          }
        } catch (e) {
          console.log('⚠️ Error finding attacker:', e.message)
        }
      }
      
      // Sentry target got hit - retaliate with 5 hits
      if (sentryMode && sentryTarget && entity === sentryTarget && !sentryInterval) {
        console.log(`🛡️ Sentry target was hit!`)
        
        try {
          const attacker = bot.nearestEntity(e => {
            if (!e || !e.position) return false
            
            try {
              const dist = e.position.distanceTo(sentryTarget.position)
              
              // Check if it's a player or mob
              if ((e.type === 'player' || e.type === 'mob' || e.type === 'hostile') && e.username !== bot.username) {
                // Don't attack sentry target
                if (e.username === sentryTarget.username) return false
                
                // Must be close enough to have hit them
                if (dist < 6) {
                  return true
                }
              }
            } catch (e) {
              return false
            }
            
            return false
          })
          
          if (attacker && attacker.position) {
            const attackerName = attacker.username || attacker.displayName || attacker.name || 'entity'
            bot.chat(`⚔️ Retaliating against ${attackerName} for hitting ${sentryTarget.username}!`)
            retaliate(attacker)
          } else {
            console.log('⚠️ Sentry target took damage but no attacker found')
          }
        } catch (e) {
          console.log('⚠️ Error finding attacker for sentry:', e.message)
        }
      }
    } catch (err) {
      console.error('Error handling entity hurt:', err.message)
      // Don't crash, just log and continue
    }
  })
  
  // Catch any unhandled errors
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err.message)
    console.error(err.stack)
    // Don't exit, keep running
  })
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection:', reason)
    // Don't exit, keep running
  })
  
  // Recovery from knockback - clear controls when flying through air
  let lastKnockbackCheck = 0
  bot.on('physicsTick', () => {
    if (!bot || !bot.entity || !bot.entity.velocity) return
    
    const now = Date.now()
    
    // Check for extreme velocity every 100ms
    if (now - lastKnockbackCheck > 100) {
      lastKnockbackCheck = now
      
      const vel = bot.entity.velocity
      
      // If bot has extreme velocity, it's been knocked back - clear controls
      if (Math.abs(vel.y) > 1.5 || Math.abs(vel.x) > 0.8 || Math.abs(vel.z) > 0.8) {
        try {
          bot.clearControlStates()
        } catch (e) {}
      }
    }
  })
}

createBot()
