require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');
const fs = require('fs');

// ── CONFIG ─────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const POINTS_FILE = './points.json';

const ADMIN_ROLES = ['OWNERSHIP', '/C', '/Agent', '/Q', 'Server Developer', 'System Bots', 'Bots', '/EspControl'];
const WAITING_VC_NAME = '⌛・Waiting';

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

const games = new Map(); // gameId → game
const botMoving = new Set(); // userIds being moved by bot (skip timeout)

// ── HELPERS ────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).substring(2, 10);
}

function loadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}

function savePoints(data) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(data, null, 2));
}

function getRank(userId) {
  const pts = loadPoints();
  if (!pts[userId] || pts[userId].pts === 0) return null;
  const sorted = Object.entries(pts).sort((a, b) => b[1].pts - a[1].pts);
  const idx = sorted.findIndex(([id]) => id === userId);
  return idx === -1 ? null : idx + 1;
}

function displayName(user) {
  const rank = getRank(user.id);
  return rank ? `RANK ${rank} | ${user.username}` : user.username;
}

function isAdmin(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.some(r => ADMIN_ROLES.includes(r.name))
  );
}

// Check if user is in any VC named exactly WAITING_VC_NAME
async function isInWaiting(guild, userId) {
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!member?.voice?.channel) return false;
  return member.voice.channel.name === WAITING_VC_NAME;
}

// Get first waiting VC in guild
function getWaitingVC(guild) {
  return guild.channels.cache.find(
    c => c.type === ChannelType.GuildVoice && c.name === WAITING_VC_NAME
  ) || null;
}

// Update a member's nickname to show rank (skip admins + owner)
async function updateNickname(guild, userId) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    if (member.id === guild.ownerId) return;
    if (isAdmin(member)) return;

    const rank = getRank(userId);
    const base = member.user.username;
    const newNick = rank ? `RANK ${rank} | ${base}` : base;

    if (member.nickname !== newNick) {
      await member.setNickname(newNick).catch(() => {});
    }
  } catch {}
}

// Refresh all ranked members' nicknames
async function refreshAllNicknames(guild) {
  const pts = loadPoints();
  for (const userId of Object.keys(pts)) {
    await updateNickname(guild, userId);
  }
}

// ── POINTS ─────────────────────────────────────────────────
// MVP Win:  MVP +100pts (50 bonus + 50 win), Teammates +50pts each
// MVP Lose: MVP +50pts  (30 bonus + 20 loss), Teammates +20pts each
async function awardPoints(guild, target, result, channel, game = null) {
  const pts = loadPoints();
  if (!pts[target.id]) pts[target.id] = { username: target.username, pts: 0 };

  if (result === 'win') {
    pts[target.id].pts += 100;
    pts[target.id].username = target.username;
    if (game) {
      const team = game.team1.some(u => u.id === target.id) ? game.team1 : game.team2;
      for (const u of team) {
        if (u.id === target.id) continue;
        if (!pts[u.id]) pts[u.id] = { username: u.username, pts: 0 };
        pts[u.id].pts += 50;
        pts[u.id].username = u.username;
      }
    }
    savePoints(pts);

    if (channel) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🏆 MVP WINNER')
            .setDescription(
              `**${displayName(target)}**\n\n` +
              `🥇 MVP: **+100 pts**\n` +
              `👥 Teammates: **+50 pts** each`
            )
            .setColor(0xffd700)
            .setFooter({ text: '50 bonus + 50 win = 100' })
        ]
      }).catch(() => {});
    }
  } else {
    pts[target.id].pts += 50;
    pts[target.id].username = target.username;
    if (game) {
      const team = game.team1.some(u => u.id === target.id) ? game.team1 : game.team2;
      for (const u of team) {
        if (u.id === target.id) continue;
        if (!pts[u.id]) pts[u.id] = { username: u.username, pts: 0 };
        pts[u.id].pts += 20;
        pts[u.id].username = u.username;
      }
    }
    savePoints(pts);

    if (channel) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎖️ MVP LOSER')
            .setDescription(
              `**${displayName(target)}**\n\n` +
              `🥈 MVP: **+50 pts**\n` +
              `👥 Teammates: **+20 pts** each`
            )
            .setColor(0x99aab5)
            .setFooter({ text: '30 bonus + 20 loss = 50' })
        ]
      }).catch(() => {});
    }
  }

  // Update nicknames after points change
  if (guild) {
    const allUsers = game ? [...game.team1, ...game.team2] : [target];
    for (const u of allUsers) await updateNickname(guild, u.id);
  }
}

// ── SLASH COMMANDS ─────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Create a Free Fire match lobby (must be in ⌛・Waiting)')
    .addStringOption(o =>
      o.setName('mode').setDescription('Match mode').setRequired(true)
        .addChoices(
          { name: '1v1', value: '1v1' },
          { name: '2v2', value: '2v2' },
          { name: '3v3', value: '3v3' },
          { name: '4v4', value: '4v4' },
          { name: '6v6', value: '6v6' },
        )
    ),
  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Award MVP points (admin only)')
    .addUserOption(o => o.setName('player').setDescription('The MVP player').setRequired(true))
    .addStringOption(o =>
      o.setName('result').setDescription('Win or lose?').setRequired(true)
        .addChoices({ name: 'Win', value: 'win' }, { name: 'Lose', value: 'lose' })
    ),
  new SlashCommandBuilder()
    .setName('cancelmatch')
    .setDescription('Force cancel a match (admin only)')
    .addStringOption(o => o.setName('roomid').setDescription('Room ID of the match').setRequired(true)),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 players'),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your rank and points'),
].map(c => c.toJSON());

// ── READY ──────────────────────────────────────────────────
client.on('ready', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered');
  } catch (err) {
    console.error('❌ Command register error:', err);
  }
});

// ── VOICE STATE — warn players who leave team VC ───────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const guild = oldState.guild;
    const userId = oldState.id;

    // Skip if bot is the one moving this player
    if (botMoving.has(userId)) return;

    // Find if this user is in an active match
    let playerGame = null;
    for (const [, g] of games) {
      if (g.status !== 'started') continue;
      if ([...g.team1, ...g.team2].some(u => u.id === userId)) {
        playerGame = g;
        break;
      }
    }
    if (!playerGame) return;

    const expectedVC = playerGame.team1.some(u => u.id === userId) ? playerGame.vc1 : playerGame.vc2;
    if (!expectedVC) return;

    // Only trigger if they LEFT their team VC (not joined it)
    if (oldState.channelId === expectedVC.id && newState.channelId !== expectedVC.id) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      // Apply 15 minute timeout using communicationDisabledUntil
      const until = new Date(Date.now() + 15 * 60 * 1000);
      await member.disableCommunicationUntil(until, 'Left team voice channel during active match').catch(() => {});

      await member.user.send(
        `⚠️ **Warning!**\n\n` +
        `You left your team voice channel during an active match.\n` +
        `You have been **timed out for 15 minutes**.\n\n` +
        `Match Room ID: \`${playerGame.roomID}\``
      ).catch(() => {});

      console.log(`⚠️ Timed out ${member.user.username} for leaving team VC`);
    }
  } catch (err) {
    console.error('voiceStateUpdate error:', err);
  }
});

// ── INTERACTIONS ───────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {

    // ── /play ────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
      const inWaiting = await isInWaiting(interaction.guild, interaction.user.id);
      if (!inWaiting) {
        return interaction.reply({
          content: `❌ You must be in **${WAITING_VC_NAME}** to create a match!`,
          ephemeral: true,
        });
      }

      const mode = interaction.options.getString('mode');
      const gameId = genId();

      // Store mode + gameId temporarily before modal
      // We open the modal immediately — all info in one popup
      const modal = new ModalBuilder()
        .setCustomId(`playmodal_${mode}_${gameId}`)
        .setTitle(`🎮 Free Fire ${mode} — Match Setup`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('roomID').setLabel('Room ID').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('roomPass').setLabel('Room Password').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('joinKey').setLabel('Join Key (leave blank = open lobby)').setStyle(TextInputStyle.Short).setRequired(false)
        ),
      );

      return interaction.showModal(modal);
    }

    // ── /set (admin only) ────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'set') {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ You do not have permission!', ephemeral: true });
      }

      const target = interaction.options.getUser('player');
      const result = interaction.options.getString('result');

      let playerGame = null;
      for (const [, g] of games) {
        if ([...g.team1, ...g.team2].some(u => u.id === target.id)) {
          playerGame = g; break;
        }
      }

      await awardPoints(interaction.guild, target, result, interaction.channel, playerGame);

      if (playerGame) {
        await moveToWaiting(interaction.guild, playerGame);
        await cleanupGame(playerGame);
      }

      return interaction.reply({ content: `✅ Points awarded to **${target.username}**!`, ephemeral: true });
    }

    // ── /cancelmatch (admin only) ────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'cancelmatch') {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ You do not have permission!', ephemeral: true });
      }

      const roomId = interaction.options.getString('roomid');
      let found = null;
      for (const [, g] of games) {
        if (g.roomID === roomId) { found = g; break; }
      }

      if (!found) return interaction.reply({ content: `❌ No active match with Room ID \`${roomId}\``, ephemeral: true });

      await moveToWaiting(interaction.guild, found);
      await cleanupGame(found);

      return interaction.reply({ content: `✅ Match \`${roomId}\` cancelled and players moved back.`, ephemeral: true });
    }

    // ── /leaderboard ─────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'leaderboard') {
      const pts = loadPoints();
      const sorted = Object.entries(pts)
        .filter(([, v]) => v.pts > 0)
        .sort((a, b) => b[1].pts - a[1].pts)
        .slice(0, 10);

      if (sorted.length === 0) {
        return interaction.reply({ content: '📊 No points recorded yet!', ephemeral: true });
      }

      const medals = ['🥇', '🥈', '🥉'];
      const bar = (pts, max) => {
        const filled = Math.round((pts / max) * 10);
        return '█'.repeat(filled) + '░'.repeat(10 - filled);
      };
      const max = sorted[0][1].pts;

      const rows = sorted.map(([, v], i) =>
        `${medals[i] || `\`${String(i + 1).padStart(2, '0')}.\``} **${v.username}**\n` +
        `┗ ${bar(v.pts, max)} **${v.pts} pts**`
      ).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('🏆  E S P O R T S  L E A D E R B O A R D')
        .setDescription(rows)
        .setColor(0xffd700)
        .setFooter({ text: `Top ${sorted.length} players • Updated now` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ── /rank ────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'rank') {
      const pts = loadPoints();
      const data = pts[interaction.user.id];
      const rank = getRank(interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle('📊 Player Stats')
        .setDescription(
          `**${interaction.user.username}**\n\n` +
          `🏅 **Rank:** ${rank ? `#${rank}` : 'Unranked'}\n` +
          `⭐ **Points:** ${data?.pts || 0} pts`
        )
        .setColor(rank ? 0x5865f2 : 0x99aab5)
        .setThumbnail(interaction.user.displayAvatarURL());

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── MODAL: play setup ────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('playmodal_')) {
      const parts = interaction.customId.split('_');
      const mode = parts[1];
      const gameId = parts[2];
      const teamSize = parseInt(mode.split('v')[0]);

      const roomID = interaction.fields.getTextInputValue('roomID').trim();
      const roomPass = interaction.fields.getTextInputValue('roomPass').trim();
      const joinKey = interaction.fields.getTextInputValue('joinKey').trim() || null;

      const game = {
        gameId,
        messageId: null,
        host: interaction.user,
        mode,
        teamSize,
        team1: [interaction.user],
        team2: [],
        roomID,
        roomPass,
        joinKey,
        status: 'lobby',
        votes: {},
        playerVoted: new Set(),
        voteChannel: null,
        vc1: null,
        vc2: null,
        category: null,
      };

      const sent = await interaction.channel.send({
        embeds: [lobbyEmbed(game)],
        components: [lobbyButtons(gameId)],
      });

      game.messageId = sent.id;
      games.set(gameId, game);

      return interaction.reply({ content: '✅ Lobby created!', ephemeral: true });
    }

    // ── MODAL: join key ──────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('keymodal_')) {
      const parts = interaction.customId.split('_');
      const gameId = parts[1];
      const teamNum = parseInt(parts[2]);
      const game = games.get(gameId);

      if (!game) return interaction.reply({ content: '❌ Lobby expired!', ephemeral: true });

      const entered = interaction.fields.getTextInputValue('keyInput').trim();
      if (entered !== game.joinKey) {
        return interaction.reply({ content: '❌ Wrong key! You cannot join this match.', ephemeral: true });
      }

      return addToTeam(interaction, game, teamNum, true);
    }

    // ── BUTTONS ──────────────────────────────────────────
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Join Team 1 or 2
      if (customId.startsWith('join1_') || customId.startsWith('join2_')) {
        const teamNum = customId.startsWith('join1_') ? 1 : 2;
        const gameId = customId.split('_')[1];
        const game = games.get(gameId);

        if (!game) return interaction.reply({ content: '❌ Lobby expired!', ephemeral: true });
        if (game.status !== 'lobby') return interaction.reply({ content: '❌ Match already started!', ephemeral: true });

        // Must be in waiting VC
        const inWaiting = await isInWaiting(interaction.guild, interaction.user.id);
        if (!inWaiting) {
          return interaction.reply({
            content: `❌ You must be in **${WAITING_VC_NAME}** to join a match!`,
            ephemeral: true,
          });
        }

        // Already in game?
        const allPlayers = [...game.team1, ...game.team2];
        if (allPlayers.some(u => u.id === interaction.user.id)) {
          return interaction.reply({ content: '❌ You are already in this lobby!', ephemeral: true });
        }

        // Key protected?
        if (game.joinKey && interaction.user.id !== game.host.id) {
          const modal = new ModalBuilder()
            .setCustomId(`keymodal_${gameId}_${teamNum}`)
            .setTitle('🔑 Enter Join Key');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('keyInput').setLabel('Join Key').setStyle(TextInputStyle.Short).setRequired(true)
            )
          );
          return interaction.showModal(modal);
        }

        return addToTeam(interaction, game, teamNum, false);
      }

      // Leave
      if (customId === 'leave') {
        const gameId = [...games.keys()].find(id => games.get(id).messageId === interaction.message.id);
        const game = games.get(gameId);
        if (!game) return interaction.reply({ content: '❌ Lobby not found!', ephemeral: true });
        if (interaction.user.id === game.host.id) return interaction.reply({ content: '❌ Host cannot leave! Cancel instead.', ephemeral: true });

        game.team1 = game.team1.filter(u => u.id !== interaction.user.id);
        game.team2 = game.team2.filter(u => u.id !== interaction.user.id);

        await interaction.message.edit({ embeds: [lobbyEmbed(game)], components: [lobbyButtons(game.gameId)] });
        return interaction.deferUpdate();
      }

      // Cancel (host only)
      if (customId === 'cancel') {
        const gameId = [...games.keys()].find(id => games.get(id).messageId === interaction.message.id);
        const game = games.get(gameId);
        if (!game) return interaction.reply({ content: '❌ Lobby not found!', ephemeral: true });
        if (interaction.user.id !== game.host.id) return interaction.reply({ content: '❌ Only the host can cancel!', ephemeral: true });

        games.delete(gameId);
        await interaction.message.delete().catch(() => {});
        return interaction.deferUpdate();
      }

      // Start (host only, teams must be full)
      if (customId === 'start') {
        const gameId = [...games.keys()].find(id => games.get(id).messageId === interaction.message.id);
        const game = games.get(gameId);
        if (!game) return interaction.reply({ content: '❌ Lobby not found!', ephemeral: true });
        if (interaction.user.id !== game.host.id) return interaction.reply({ content: '❌ Only the host can start!', ephemeral: true });
        if (game.team1.length < game.teamSize || game.team2.length < game.teamSize) {
          return interaction.reply({ content: '❌ Both teams must be full to start!', ephemeral: true });
        }

        game.status = 'started';
        await interaction.deferUpdate();
        return startMatch(game, interaction.guild, interaction.message);
      }

      // End Match (host only)
      if (customId.startsWith('endmatch_')) {
        const gameId = customId.replace('endmatch_', '');
        const game = games.get(gameId);
        if (!game) return interaction.reply({ content: '❌ Match not found!', ephemeral: true });
        if (interaction.user.id !== game.host.id) return interaction.reply({ content: '❌ Only the host can end the match!', ephemeral: true });

        await interaction.update({ embeds: [new EmbedBuilder().setTitle('✅ Match Ended').setDescription('Voting is now open!').setColor(0x57f287)], components: [] });
        return postVotes(game);
      }

      // MVP Vote dropdowns
      if (customId.startsWith('mvpwin_') || customId.startsWith('mvplose_')) {
        const parts = customId.split('_');
        const voteType = parts[1]; // win or lose
        const gameId = parts[2];
        const game = games.get(gameId);

        if (!game) return interaction.reply({ content: '❌ Match expired!', ephemeral: true });

        // Allowed voters: host + first of team2 + admins
        const canVote = [game.host.id, game.team2[0]?.id].filter(Boolean);
        const voterIsAdmin = isAdmin(interaction.member);
        if (!canVote.includes(interaction.user.id) && !voterIsAdmin) {
          return interaction.reply({ content: '❌ Only the **host**, **first player of Team 2**, or an **admin** can vote!', ephemeral: true });
        }

        const selectedId = interaction.values[0];
        if (!game.votes[interaction.user.id]) game.votes[interaction.user.id] = { win: null, lose: null };

        if (voteType === 'win' && game.votes[interaction.user.id].win) {
          return interaction.reply({ content: '❌ You already selected MVP Winner!', ephemeral: true });
        }
        if (voteType === 'lose' && game.votes[interaction.user.id].lose) {
          return interaction.reply({ content: '❌ You already selected MVP Loser!', ephemeral: true });
        }

        game.votes[interaction.user.id][voteType] = selectedId;

        if (game.votes[interaction.user.id].win && game.votes[interaction.user.id].lose) {
          game.playerVoted.add(interaction.user.id);
        }

        const winCount = Object.values(game.votes).filter(v => v.win).length;
        const loseCount = Object.values(game.votes).filter(v => v.lose).length;

        await interaction.reply({
          content: `✅ Vote recorded!\n👑 Win votes: **${winCount}** | 💀 Lose votes: **${loseCount}**`,
          ephemeral: true,
        });

        // Tally when all 3 eligible voters have voted for both
        if (game.playerVoted.size >= 3 || game.playerVoted.size >= canVote.length) {
          await tallyVotes(game, interaction.guild);
        }
      }
    }

    // ── SELECT MENU interactions ──────────────────────────
    if (interaction.isStringSelectMenu()) {
      const { customId } = interaction;

      if (customId.startsWith('vote_win_') || customId.startsWith('vote_lose_')) {
        const parts = customId.split('_');
        const voteType = parts[1]; // win or lose
        const gameId = parts[2];
        const game = games.get(gameId);

        if (!game) return interaction.reply({ content: '❌ Match expired!', ephemeral: true });

        // Allowed voters: host + first of team2 + admins
        const canVote = [game.host.id, game.team2[0]?.id].filter(Boolean);
        const voterIsAdmin = isAdmin(interaction.member);
        if (!canVote.includes(interaction.user.id) && !voterIsAdmin) {
          return interaction.reply({ content: '❌ Only the **host**, **first player of Team 2**, or an **admin** can vote!', ephemeral: true });
        }

        const selectedId = interaction.values[0];
        const allPlayers = [...game.team1, ...game.team2];
        const selectedPlayer = allPlayers.find(u => u.id === selectedId);

        if (!game.votes[interaction.user.id]) game.votes[interaction.user.id] = { win: null, lose: null };

        if (voteType === 'win' && game.votes[interaction.user.id].win) {
          return interaction.reply({ content: '❌ You already voted for MVP Winner!', ephemeral: true });
        }
        if (voteType === 'lose' && game.votes[interaction.user.id].lose) {
          return interaction.reply({ content: '❌ You already voted for MVP Loser!', ephemeral: true });
        }

        game.votes[interaction.user.id][voteType] = selectedId;

        if (game.votes[interaction.user.id].win && game.votes[interaction.user.id].lose) {
          game.playerVoted.add(interaction.user.id);
        }

        const winCount = Object.values(game.votes).filter(v => v.win).length;
        const loseCount = Object.values(game.votes).filter(v => v.lose).length;

        await interaction.reply({
          content:
            `✅ Voted! You selected **${selectedPlayer?.username || 'Unknown'}** as ` +
            `${voteType === 'win' ? '👑 MVP Winner' : '💀 MVP Loser'}\n` +
            `Win votes: **${winCount}** | Lose votes: **${loseCount}**`,
          ephemeral: true,
        });

        // Tally once enough people voted
        if (game.playerVoted.size >= Math.min(3, canVote.length)) {
          await tallyVotes(game, interaction.guild);
        }
      }
    }

  } catch (err) {
    console.error('❌ Interaction error:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Something went wrong. Try again.', ephemeral: true });
      }
    } catch {}
  }
});

// ── ADD TO TEAM ────────────────────────────────────────────
async function addToTeam(interaction, game, teamNum, fromModal) {
  const team = teamNum === 1 ? game.team1 : game.team2;

  if (team.length >= game.teamSize) {
    return interaction.reply({ content: `❌ Team ${teamNum} is full!`, ephemeral: true });
  }

  team.push(interaction.user);

  const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [lobbyEmbed(game)], components: [lobbyButtons(game.gameId)] });

  if (fromModal) {
    return interaction.reply({ content: `✅ You joined Team ${teamNum}!`, ephemeral: true });
  } else {
    return interaction.deferUpdate();
  }
}

// ── START MATCH ────────────────────────────────────────────
async function startMatch(game, guild, lobbyMessage) {
  try {
    const allPlayers = [...game.team1, ...game.team2];
    const adminRole = guild.roles.cache.find(r => r.name === '/EspControl');

    // Create category
    const category = await guild.channels.create({
      name: `Match • ${game.roomID}`,
      type: ChannelType.GuildCategory,
    });

    // Team voice channels
    const vc1 = await guild.channels.create({ name: '🔴 Team 1', type: ChannelType.GuildVoice, parent: category.id });
    const vc2 = await guild.channels.create({ name: '🟢 Team 2', type: ChannelType.GuildVoice, parent: category.id });

    // Private vote channel — only players + admins
    const perms = [
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      ...allPlayers.map(u => ({
        id: u.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
        deny: [PermissionsBitField.Flags.SendMessages],
      })),
    ];
    if (adminRole) {
      perms.push({ id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
    }

    const voteChannel = await guild.channels.create({
      name: `🗳️・vote-${game.roomID}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: perms,
    });

    game.category = category;
    game.vc1 = vc1;
    game.vc2 = vc2;
    game.voteChannel = voteChannel;

    // DM all players
    const dm =
      `🎮 **Match Starting!**\n\n` +
      `📋 Room ID: \`${game.roomID}\`\n` +
      `🔑 Password: \`${game.roomPass}\`` +
      (game.joinKey ? `\n🗝️ Key: \`${game.joinKey}\`` : '');

    for (const u of allPlayers) await u.send(dm).catch(() => {});

    // Move to team VCs
    for (const u of game.team1) {
      botMoving.add(u.id);
      const m = await guild.members.fetch(u.id).catch(() => null);
      if (m?.voice?.channel) await m.voice.setChannel(vc1).catch(() => {});
      setTimeout(() => botMoving.delete(u.id), 3000);
    }
    for (const u of game.team2) {
      botMoving.add(u.id);
      const m = await guild.members.fetch(u.id).catch(() => null);
      if (m?.voice?.channel) await m.voice.setChannel(vc2).catch(() => {});
      setTimeout(() => botMoving.delete(u.id), 3000);
    }

    // Post End Match button in vote channel
    const matchEmbed = new EmbedBuilder()
      .setTitle('🎮 Match in Progress')
      .setDescription(
        `**Mode:** ${game.mode.toUpperCase()}\n` +
        `**Room:** \`${game.roomID}\`\n\n` +
        `When the match ends, **host clicks End Match** to open voting.\n` +
        `Admins can use \`/set @player mvp win/lose\` to manually award.`
      )
      .addFields(
        { name: '🔴 Team 1', value: game.team1.map(u => displayName(u)).join('\n'), inline: true },
        { name: '🟢 Team 2', value: game.team2.map(u => displayName(u)).join('\n'), inline: true },
      )
      .setColor(0x5865f2);

    await voteChannel.send({
      embeds: [matchEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`endmatch_${game.gameId}`).setLabel('🏁 End Match').setStyle(ButtonStyle.Primary)
        )
      ]
    });

    // Delete lobby message
    await lobbyMessage.delete().catch(() => {});

    console.log(`✅ Match started: ${game.roomID}`);
  } catch (err) {
    console.error('❌ startMatch error:', err);
  }
}

// ── POST VOTE DROPDOWNS ────────────────────────────────────
async function postVotes(game) {
  const allPlayers = [...game.team1, ...game.team2];

  const embed = new EmbedBuilder()
    .setTitle('🗳️ MVP VOTE')
    .setDescription(
      `**Voters:** Host + First player of Team 2 + Admins\n\n` +
      `🔴 **Team 1:** ${game.team1.map(u => u.username).join(', ')}\n` +
      `🟢 **Team 2:** ${game.team2.map(u => u.username).join(', ')}\n\n` +
      `Select **MVP Winner** 👑 and **MVP Loser** 💀 from the dropdowns below.`
    )
    .setColor(0xffd700);

  const options = allPlayers.map(u =>
    new StringSelectMenuOptionBuilder()
      .setLabel(u.username)
      .setValue(u.id)
      .setDescription(`Vote for ${u.username}`)
  );

  const winMenu = new StringSelectMenuBuilder()
    .setCustomId(`vote_win_${game.gameId}`)
    .setPlaceholder('👑 Select MVP Winner')
    .addOptions(options);

  const loseMenu = new StringSelectMenuBuilder()
    .setCustomId(`vote_lose_${game.gameId}`)
    .setPlaceholder('💀 Select MVP Loser')
    .addOptions(options);

  await game.voteChannel.send({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(winMenu),
      new ActionRowBuilder().addComponents(loseMenu),
    ],
  });
}

// ── TALLY VOTES ────────────────────────────────────────────
async function tallyVotes(game, guild) {
  const allPlayers = [...game.team1, ...game.team2];
  const winTally = {};
  const loseTally = {};

  for (const v of Object.values(game.votes)) {
    if (v.win) winTally[v.win] = (winTally[v.win] || 0) + 1;
    if (v.lose) loseTally[v.lose] = (loseTally[v.lose] || 0) + 1;
  }

  const mvpWinId = Object.entries(winTally).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mvpLoseId = Object.entries(loseTally).sort((a, b) => b[1] - a[1])[0]?.[0];

  const mvpWin = mvpWinId ? allPlayers.find(u => u.id === mvpWinId) : null;
  const mvpLose = mvpLoseId ? allPlayers.find(u => u.id === mvpLoseId) : null;

  if (mvpWin) await awardPoints(guild, mvpWin, 'win', game.voteChannel, game);
  if (mvpLose) await awardPoints(guild, mvpLose, 'lose', game.voteChannel, game);

  await game.voteChannel.send('✅ Voting complete! Moving everyone back to waiting in 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  await moveToWaiting(guild, game);
  await cleanupGame(game);
}

// ── MOVE PLAYERS TO WAITING ────────────────────────────────
async function moveToWaiting(guild, game) {
  const waitingVC = getWaitingVC(guild);
  if (!waitingVC) return;

  const allPlayers = [...game.team1, ...game.team2];
  for (const u of allPlayers) {
    botMoving.add(u.id);
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (m?.voice?.channel) await m.voice.setChannel(waitingVC).catch(() => {});
    setTimeout(() => botMoving.delete(u.id), 3000);
  }
}

// ── CLEANUP GAME ───────────────────────────────────────────
async function cleanupGame(game) {
  games.delete(game.gameId);
  await new Promise(r => setTimeout(r, 1000));
  if (game.voteChannel) await game.voteChannel.delete().catch(() => {});
  if (game.vc1) await game.vc1.delete().catch(() => {});
  if (game.vc2) await game.vc2.delete().catch(() => {});
  if (game.category) await game.category.delete().catch(() => {});
}

// ── LOBBY EMBED ────────────────────────────────────────────
function lobbyEmbed(game) {
  const fmt = t => t.length ? t.map(u => displayName(u)).join('\n') : '_Empty_';
  return new EmbedBuilder()
    .setTitle(`🐾 Free Fire ${game.mode.toUpperCase()} — Lobby`)
    .setDescription(`Host: **${displayName(game.host)}**`)
    .addFields(
      { name: `🔴 Team 1 (${game.team1.length}/${game.teamSize})`, value: fmt(game.team1), inline: true },
      { name: `🟢 Team 2 (${game.team2.length}/${game.teamSize})`, value: fmt(game.team2), inline: true },
    )
    .setColor(0x2b2d31)
    .setFooter({ text: game.joinKey ? '🔒 Key protected lobby' : '🔓 Open lobby — must be in ⌛・Waiting to join' });
}

// ── LOBBY BUTTONS ──────────────────────────────────────────
function lobbyButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`join1_${gameId}`).setLabel('Join Team 1 🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`join2_${gameId}`).setLabel('Join Team 2 🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
  );
}

// ── ERROR HANDLING ─────────────────────────────────────────
client.on('error', err => console.error('❌ Client error:', err));
process.on('unhandledRejection', err => console.error('❌ Unhandled rejection:', err));

client.login(TOKEN);