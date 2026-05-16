# Mineflayer Bot

This is a separate Minecraft bot project. It does not edit or depend on your Paper server files.

## Install

```bash
cd "mineflayer bot"
npm install
```

## Run

Start your Minecraft server first, then run:

```bash
npm start
```

The default config joins:

- Host: `127.0.0.1`
- Port: `25565`
- Username: `DarkieBot`
- Auth: `offline`

Your server currently has `online-mode=false`, so the default offline bot can join as a normal player.

## Configure

Edit `config.json`.

Useful settings:

- `username`: bot player name.
- `host`: server IP.
- `port`: server port.
- `commandPrefix`: default is `!bot`.
- `allowEveryone`: if `true`, any player can use bot commands.
- `allowedUsers`: if `allowEveryone` is `false`, only these names can use commands.
- `reconnect`: reconnect after disconnect.
- `maxCollectBlocks`: safety cap for one collect/mine command.
- `maxBuildBlocks`: safety cap for one build command.
- `autoSelfDefense`: lets the bot fight hostile mobs near itself.
- `selfDefenseRange`: range for automatic self-defense.
- `avoidCreepers`: makes the bot move away from nearby creepers.
- `creeperAvoidRange`: creeper danger range.
- `panicHealth`: health level where the bot stops risky tasks and tries to recover.
- `maxSafeDrop`: pathfinding drop limit to reduce fall damage.
- `practiceRange`: range for player sparring practice.
- `practiceAttackDelayMs`: delay between practice hits.

## In-Game Commands

Type these in Minecraft chat:

```text
!bot help
!bot status
!bot come
!bot follow
!bot follow PlayerName
!bot stop
!bot guard
!bot unguard
!bot practice
!bot stoppractice
!bot armor
!bot eat
!bot inv
!bot blocks
!bot buildhelp
!bot place dirt front
!bot place dirt under
!bot place dirt 100 64 100
!bot line oak_planks 8 north
!bot wall cobblestone 6 3 east
!bot floor stone 5 5 south
!bot bridge dirt 10 north
!bot pillar cobblestone 4
!bot supply oak_planks 32
!bot supply stone 64 PlayerName
!bot toss dirt 16
!bot collect oak_log 3
!bot dig stone
!bot mine jungle_log 4 stacks
!bot look
!bot jump
!bot sneak
!bot unsneak
!bot say hello
```

The bot uses normal player actions. It does not need OP.

## Building Help

Give the bot blocks first, then use `!bot buildhelp` in chat.

Build commands use normal survival placement:

- The bot must have the block in its inventory.
- The target spot must be air.
- The target spot needs a neighboring solid block to place against.
- Big builds are capped by `maxBuildBlocks` in `config.json`.

Directions are `north`, `south`, `east`, or `west`. If no direction is given, the bot uses the direction it is facing.

## AI-Like Features

This bot now has a lightweight local command brain. It does not use a paid AI API, so it is fast and free, but it can understand common natural phrases and turn them into safe Mineflayer actions.

Config settings:

- `aiEnabled`: enables natural-language handling.
- `listenForName`: lets the bot respond when players start a message with the bot name.
- `aiWakeWords`: extra wake words, default `bot` and `darkiebot`.
- `guardRange`: how far the bot checks for hostile mobs while guarding.

Natural chat examples:

```text
DarkieBot what can you do
DarkieBot come here
DarkieBot follow me
DarkieBot stop
DarkieBot where are you
DarkieBot scan nearby
DarkieBot remember this place
DarkieBot go home
DarkieBot guard me
DarkieBot practice with me
DarkieBot stop practice
DarkieBot stop guarding
DarkieBot wear armor
DarkieBot eat food
DarkieBot what do you have
DarkieBot what building blocks do you have
DarkieBot give me 32 dirt
DarkieBot collect 5 oak_log
DarkieBot mine jungle_log 4 stacks
DarkieBot mine jungle log 100
DarkieBot mine stone
DarkieBot build a bridge
DarkieBot build a 5 by 3 wall with cobblestone north
DarkieBot build a 5 by 5 floor with oak_planks
DarkieBot build a bridge 10 with dirt east
DarkieBot build a pillar 6 with cobblestone
DarkieBot kill PlayerName
```

You can also force natural-language mode with:

```text
!bot ai build a 5 by 3 wall with cobblestone north
!bot ai give me 32 dirt
!bot ai guard me
```

What the AI-like layer can do:

- Understand simple player helper requests.
- Follow, come, stop, scan, and report coordinates.
- Save a home position and return to it.
- Equip armor and eat food from its own inventory.
- Supply items to players by walking over and dropping them.
- Collect or mine nearby blocks, including quantities like `100` or `4 stacks`.
- Build simple lines, walls, floors, bridges, and pillars.
- Guard a player by following them and attacking nearby hostile mobs.
- Protect itself from hostile mobs.
- Back away from creepers instead of running into explosions.
- Avoid planned pathfinding drops above `maxSafeDrop`.
- Stop risky actions at low health and try to recover.
- Spar with players in practice mode.
- Treat `kill PlayerName` as practice mode instead of unsafe uncontrolled hunting.

Limits:

- It is not a full large language model.
- It cannot use OP commands.
- It must have items before it can place or supply them.
- It places blocks like a normal survival player, so impossible placements will fail.
- Practice mode attacks the selected player slowly, so only use it where PvP/practice is allowed.

## Safety And Practice Features

The bot now has extra survival behavior:

- Self-defense: if `autoSelfDefense` is enabled, it attacks nearby hostile mobs.
- Creeper safety: if `avoidCreepers` is enabled, it backs away from creepers before fighting.
- Fall safety: pathfinding uses `maxSafeDrop` so the bot avoids planned jumps or routes with bigger drops.
- Panic recovery: below `panicHealth`, it stops follow/guard/practice tasks, tries to eat, and moves away from danger.
- Best weapon: before fighting mobs or sparring, it equips the best sword or axe it has.

Practice commands:

```text
!bot practice
!bot practice PlayerName
!bot stoppractice
DarkieBot practice with me
DarkieBot stop practice
```

Practice mode is for players to train with the bot. It follows the selected player and attacks slowly using `practiceAttackDelayMs`, so it feels more like sparring than instant spam.

## Parser Fix Notes

The bot accepts both exact Minecraft IDs and friendlier names:

```text
DarkieBot mine jungle_log 4 stacks
DarkieBot mine jungle log 4 stacks
DarkieBot mine jungle 100
```

`stack` and `stacks` mean 64 blocks each. For example, `4 stacks` means `256` blocks, capped by `maxCollectBlocks` in `config.json`.

If you say:

```text
DarkieBot build a bridge
```

the bot now uses a default bridge size and the first placeable block it has. If it has no blocks, give it blocks first.
