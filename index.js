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
  AttachmentBuilder,
  ChannelType,
} = require('discord.js');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// ── CONFIG ─────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const POINTS_FILE = './points.json';

const ADMIN_ROLES = ['OWNERSHIP', '/C', '/Agent', '/Q', 'Server Developer', 'System Bots', 'Bots', '/EspControl'];
const WAITING_VC_NAME = '⌛・Waiting';
const PLAY_CHANNEL_ID  = '1500952513980141711';

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

const games = new Map();
const botMoving = new Set();

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

async function isInWaiting(guild, userId) {
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!member?.voice?.channel) return false;
  return member.voice.channel.name === WAITING_VC_NAME;
}

function getWaitingVC(guild) {
  return guild.channels.cache.find(
    c => c.type === ChannelType.GuildVoice && c.name === WAITING_VC_NAME
  ) || null;
}

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

// ── CANVAS HELPERS ─────────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAvatarFallback(ctx, cx, cy, r, username) {
  const palette = ['#5865F2','#57F287','#FEE75C','#EB459E','#ED4245','#00b0f4'];
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = palette[username.charCodeAt(0) % palette.length];
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + Math.round(r * 0.9) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(username.charAt(0).toUpperCase(), cx, cy);
  ctx.textBaseline = 'alphabetic';
}

// ── GENERATE LEADERBOARD IMAGE ───────────────────────────────
async function generateLeaderboardImage(guild, pageData, pageIndex, totalPages, totalPlayers, globalStart) {
  const W      = 740;
  const HDR_H  = 105;
  const COL_H  = 36;
  const ROW_H  = 58;
  const FOOT_H = 36;
  const H      = HDR_H + COL_H + pageData.length * ROW_H + FOOT_H;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0f1021');
  bgGrad.addColorStop(1, '#0b0c18');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // dot grid texture
  ctx.fillStyle = 'rgba(255,255,255,0.018)';
  for (let gx = 20; gx < W; gx += 28)
    for (let gy = 20; gy < H; gy += 28) {
      ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
    }

  // header panel
  const hGrad = ctx.createLinearGradient(0, 0, W, HDR_H);
  hGrad.addColorStop(0, '#1b1d35');
  hGrad.addColorStop(1, '#14162a');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, W, HDR_H);

  // accent stripe top
  const acGrad = ctx.createLinearGradient(0, 0, W, 0);
  acGrad.addColorStop(0, '#5865f2');
  acGrad.addColorStop(0.5, '#9b59b6');
  acGrad.addColorStop(1, '#5865f2');
  ctx.fillStyle = acGrad;
  ctx.fillRect(0, 0, W, 4);

  // header bottom line
  ctx.fillStyle = 'rgba(88,101,242,0.35)';
  ctx.fillRect(0, HDR_H - 1, W, 1);

  // title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('PLAYER LEADERBOARD', W / 2, 48);

  // subtitle
  ctx.fillStyle = '#7986b0';
  ctx.font = '13px Arial';
  ctx.fillText('Page ' + (pageIndex + 1) + '/' + totalPages + '  •  ' + totalPlayers + ' players', W / 2, 76);

  // column headers
  ctx.fillStyle = 'rgba(15,17,33,0.95)';
  ctx.fillRect(0, HDR_H, W, COL_H);
  ctx.fillStyle = '#4a5675';
  ctx.font = 'bold 11px Arial';
  const colY = HDR_H + COL_H / 2 + 4;
  const C = { rank: 55, avatar: 115, player: 155, wl: 440, mvp: 555, pts: 668 };
  ctx.textAlign = 'center'; ctx.fillText('RANK',   C.rank,   colY);
  ctx.textAlign = 'left';   ctx.fillText('PLAYER', C.player, colY);
  ctx.textAlign = 'center'; ctx.fillText('W/L',    C.wl,     colY);
  ctx.textAlign = 'center'; ctx.fillText('MVP',    C.mvp,    colY);
  ctx.textAlign = 'center'; ctx.fillText('POINTS', C.pts,    colY);

  // pre-fetch avatars
  const avatarImgs = new Map();
  try {
    const ids  = pageData.map(([id]) => id);
    const mems = await guild.members.fetch({ user: ids }).catch(() => new Map());
    for (const [id, mem] of mems) {
      try {
        const url = mem.displayAvatarURL({ extension: 'png', size: 64, forceStatic: true });
        const img = await Promise.race([
          loadImage(url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
        ]);
        avatarImgs.set(id, img);
      } catch (_) {}
    }
  } catch (_) {}

  // rows
  for (let i = 0; i < pageData.length; i++) {
    const [userId, data] = pageData[i];
    const globalRank = globalStart + i + 1;
    const rowY = HDR_H + COL_H + i * ROW_H;

    // row bg
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, rowY, W, ROW_H);

    // rank colours
    let badgeHex, textHex;
    if      (globalRank === 1) { badgeHex = '#FFD700'; textHex = '#1a1200'; }
    else if (globalRank === 2) { badgeHex = '#C0C0C0'; textHex = '#111111'; }
    else if (globalRank === 3) { badgeHex = '#cd7f32'; textHex = '#1a0800'; }
    else if (globalRank <= 5)  { badgeHex = '#5865F2'; textHex = '#ffffff'; }
    else if (globalRank <= 10) { badgeHex = '#2d3050'; textHex = '#8b9fc0'; }
    else                       { badgeHex = '#1e2035'; textHex = '#5a6880'; }

    // left accent stripe top 3
    if (globalRank <= 3) {
      ctx.fillStyle = badgeHex;
      ctx.fillRect(0, rowY, 3, ROW_H);
    }

    // rank badge
    const bW = 52, bH = 28;
    const bX = C.rank - bW / 2, bY = rowY + (ROW_H - bH) / 2;
    if (globalRank <= 3) {
      ctx.shadowColor = badgeHex; ctx.shadowBlur = 10;
    }
    rrect(ctx, bX, bY, bW, bH, 7);
    ctx.fillStyle = badgeHex; ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = textHex;
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('#' + globalRank, C.rank, bY + bH / 2 + 5);

    // avatar
    const aR = 18, aCX = C.avatar, aCY = rowY + ROW_H / 2;
    const img = avatarImgs.get(userId);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(aCX, aCY, aR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, aCX - aR, aCY - aR, aR * 2, aR * 2);
      ctx.restore();
    } else {
      drawAvatarFallback(ctx, aCX, aCY, aR, data.username);
    }
    ctx.beginPath();
    ctx.arc(aCX, aCY, aR, 0, Math.PI * 2);
    ctx.strokeStyle = globalRank <= 3 ? badgeHex : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = globalRank <= 3 ? 2 : 1;
    ctx.stroke();

    const midY = rowY + ROW_H / 2 + 5;

    // username
    ctx.fillStyle = globalRank <= 3 ? '#ffffff' : '#c8d2ea';
    ctx.font = globalRank <= 3 ? 'bold 15px Arial' : '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(data.username.substring(0, 22), C.player, midY);

    // W/L
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7986b0';
    ctx.font = '13px Arial';
    ctx.fillText(data.wins + '/' + data.losses, C.wl, midY);

    // MVP
    ctx.fillText(data.mvps, C.mvp, midY);

    // points badge
    const pText = String(data.pts);
    const pW = 72, pH = 28;
    const pX = C.pts - pW / 2, pY = rowY + (ROW_H - pH) / 2;
    rrect(ctx, pX, pY, pW, pH, 7);
    ctx.fillStyle = globalRank <= 3 ? badgeHex + '28' : 'rgba(88,101,242,0.15)';
    ctx.fill();
    if (globalRank <= 3) { ctx.shadowColor = badgeHex; ctx.shadowBlur = 6; }
    ctx.fillStyle = globalRank <= 3 ? badgeHex : '#7289da';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(pText, C.pts, pY + pH / 2 + 5);
    ctx.shadowBlur = 0;

    // row separator
    if (i < pageData.length - 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(16, rowY + ROW_H - 1, W - 32, 1);
    }
    // podium divider after rank 3
    if (globalRank === 3 && pageData.length > 3) {
      ctx.fillStyle = 'rgba(88,101,242,0.3)';
      ctx.fillRect(0, rowY + ROW_H - 1, W, 1);
    }
  }

  // footer
  const fY = HDR_H + COL_H + pageData.length * ROW_H;
  ctx.fillStyle = 'rgba(10,11,22,0.9)';
  ctx.fillRect(0, fY, W, FOOT_H);
  ctx.fillStyle = 'rgba(88,101,242,0.3)';
  ctx.fillRect(0, fY, W, 1);
  const now = new Date().toLocaleString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  ctx.fillStyle = '#3a4460';
  ctx.font = '11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Last updated: ' + now + ' UTC  •  Use /rank to check your stats', W / 2, fY + FOOT_H / 2 + 4);

  return canvas.toBuffer('image/png');
}

// ── CREATE STAT BAR ────────────────────────────────────────
function createStatBar(points) {
  const maxPoints = 5000;
  const filled = Math.min(10, Math.floor((points / maxPoints) * 10));
  const empty  = 10 - filled;
  return '`' + '█'.repeat(filled) + '░'.repeat(empty) + '`';
}

// ── POINTS SYSTEM ──────────────────────────────────────────
async function awardPoints(guild, target, result, channel, game = null) {
  const pts = loadPoints();
  if (!pts[target.id]) pts[target.id] = { username: target.username, pts: 0, wins: 0, losses: 0, mvps: 0, matches: 0 };

  if (result === 'win') {
    pts[target.id].pts += 100;
    pts[target.id].mvps += 1;
    pts[target.id].wins += 1;
    pts[target.id].matches += 1;
    pts[target.id].username = target.username;
    
    if (game) {
      const team = game.team1.some(u => u.id === target.id) ? game.team1 : game.team2;
      for (const u of team) {
        if (u.id === target.id) continue;
        if (!pts[u.id]) pts[u.id] = { username: u.username, pts: 0, wins: 0, losses: 0, mvps: 0, matches: 0 };
        pts[u.id].pts += 50;
        pts[u.id].wins += 1;
        pts[u.id].matches += 1;
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
        ]
      }).catch(() => {});
    }
  } else {
    pts[target.id].pts += 50;
    pts[target.id].mvps += 1;
    pts[target.id].losses += 1;
    pts[target.id].matches += 1;
    pts[target.id].username = target.username;
    
    if (game) {
      const team = game.team1.some(u => u.id === target.id) ? game.team1 : game.team2;
      for (const u of team) {
        if (u.id === target.id) continue;
        if (!pts[u.id]) pts[u.id] = { username: u.username, pts: 0, wins: 0, losses: 0, mvps: 0, matches: 0 };
        pts[u.id].pts += 20;
        pts[u.id].losses += 1;
        pts[u.id].matches += 1;
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
        ]
      }).catch(() => {});
    }
  }

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
    .setDescription('Show the top 10 players ranked by points'),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your rank and points'),
  new SlashCommandBuilder()
    .setName('resetvote')
    .setDescription('Start a public vote to reset all player points (admin only)'),
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

// ── VOICE STATE UPDATE ─────────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const guild = oldState.guild;
    const userId = oldState.id;

    if (botMoving.has(userId)) return;

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

    if (oldState.channelId === expectedVC.id && newState.channelId !== expectedVC.id) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      const until = new Date(Date.now() + 15 * 60 * 1000);
      await member.disableCommunicationUntil(until, 'Left team voice channel during active match').catch(() => {});

      await member.user.send(
        `⚠️ **Warning!**\n\nYou left your team voice channel during an active match.\nYou have been **timed out for 15 minutes**.`
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

    // /play
    if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
      if (interaction.channelId !== PLAY_CHANNEL_ID) {
        return interaction.reply({
          content: `❌ You can only use **/play** in <#${PLAY_CHANNEL_ID}>!`,
          ephemeral: true,
        });
      }
      const inWaiting = await isInWaiting(interaction.guild, interaction.user.id);
      if (!inWaiting) {
        return interaction.reply({
          content: `❌ You must be in **${WAITING_VC_NAME}** to create a match!`,
          ephemeral: true,
        });
      }

      const mode = interaction.options.getString('mode');
      const gameId = genId();

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

    // /set (admin only)
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

    // /cancelmatch (admin only)
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

    // /leaderboard (IMAGE)
    if (interaction.isChatInputCommand() && interaction.commandName === 'leaderboard') {
      await interaction.deferReply();
      try {
        const pts = loadPoints();
        const sorted = Object.entries(pts)
          .filter(([, v]) => v.pts > 0)
          .sort((a, b) => b[1].pts - a[1].pts);

        const ITEMS        = 10;
        const totalPlayers = sorted.length;
        const totalPages   = Math.max(1, Math.ceil(totalPlayers / ITEMS));

        if (totalPlayers === 0) {
          return interaction.editReply({ content: '📭 No players ranked yet. Play matches to get on the board!' });
        }

        let currentPage = 0;
        const getSlice = (p) => {
          const s = p * ITEMS;
          return { pageData: sorted.slice(s, s + ITEMS), start: s };
        };
        const getButtons = (p) => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('lb_prev_' + p).setLabel('◄  Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
          new ButtonBuilder().setCustomId('lb_next_' + p).setLabel('Next  ►').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1)
        );

        const { pageData, start } = getSlice(0);
        const buf = await generateLeaderboardImage(interaction.guild, pageData, 0, totalPages, totalPlayers, start);
        const att = new AttachmentBuilder(buf, { name: 'leaderboard.png' });
        const msg = await interaction.editReply({
          files: [att],
          components: totalPages > 1 ? [getButtons(0)] : [],
        });

        if (totalPages <= 1) return;

        const collector = msg.createMessageComponentCollector({ time: 120000 });
        collector.on('collect', async (btn) => {
          if (btn.user.id !== interaction.user.id)
            return btn.reply({ content: '❌ Only the person who ran /leaderboard can use these buttons.', ephemeral: true });
          if (btn.customId.startsWith('lb_prev_')) currentPage = Math.max(0, currentPage - 1);
          else if (btn.customId.startsWith('lb_next_')) currentPage = Math.min(totalPages - 1, currentPage + 1);
          await btn.deferUpdate();
          const { pageData: pd, start: s } = getSlice(currentPage);
          const newBuf = await generateLeaderboardImage(interaction.guild, pd, currentPage, totalPages, totalPlayers, s);
          const newAtt = new AttachmentBuilder(newBuf, { name: 'leaderboard.png' });
          await btn.editReply({ files: [newAtt], components: [getButtons(currentPage)] });
        });
        collector.on('end', () => msg.edit({ components: [] }).catch(() => {}));
      } catch (err) {
        console.error('❌ Leaderboard error:', err);
        return interaction.editReply({ content: '❌ Failed to generate leaderboard image.' });
      }
    }

    // /resetvote (admin only)
    if (interaction.isChatInputCommand() && interaction.commandName === 'resetvote') {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ You do not have permission to start a reset vote!', ephemeral: true });
      }

      const votes = { yes: new Set(), no: new Set() };
      const DURATION = 60; // seconds

      const buildEmbed = (remaining) => new EmbedBuilder()
        .setTitle('🗳️  POINTS RESET VOTE')
        .setDescription(
          '**An admin has called a vote to reset all player points.**\n\n' +
          '✅  **Yes** — wipe all points and start fresh\n' +
          '❌  **No**  — keep the current leaderboard\n\n' +
          '```' +
          '  YES  ' + votes.yes.size + '  |  NO  ' + votes.no.size +
          '```'
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'Vote closes in ' + remaining + 's  •  Each player votes once' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rv_yes').setLabel('✅  YES — Reset').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('rv_no').setLabel('❌  NO — Keep').setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ embeds: [buildEmbed(DURATION)], components: [row] });
      const msg = await interaction.fetchReply();

      let remaining = DURATION;
      const ticker = setInterval(async () => {
        remaining -= 10;
        if (remaining > 0) {
          await msg.edit({ embeds: [buildEmbed(remaining)], components: [row] }).catch(() => {});
        }
      }, 10000);

      const collector = msg.createMessageComponentCollector({ time: DURATION * 1000 });

      collector.on('collect', async (btn) => {
        const uid = btn.user.id;
        if (btn.customId === 'rv_yes') { votes.no.delete(uid); votes.yes.add(uid); }
        else                           { votes.yes.delete(uid); votes.no.add(uid); }
        await btn.reply({ content: btn.customId === 'rv_yes' ? '✅ Voted **YES**' : '❌ Voted **NO**', ephemeral: true });
        await msg.edit({ embeds: [buildEmbed(remaining)], components: [row] }).catch(() => {});
      });

      collector.on('end', async () => {
        clearInterval(ticker);
        const yesCount = votes.yes.size;
        const noCount  = votes.no.size;
        const didReset = yesCount > noCount && yesCount >= 1;

        if (didReset) {
          savePoints({});
          const resultEmbed = new EmbedBuilder()
            .setTitle('🔄  LEADERBOARD RESET')
            .setDescription(
              '**The vote passed — all points have been wiped!**\n\n' +
              '```  YES  ' + yesCount + '  |  NO  ' + noCount + '```\n' +
              'The leaderboard is now empty. Play matches to climb back up!'
            )
            .setColor(0xed4245)
            .setTimestamp();
          await msg.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
        } else {
          const resultEmbed = new EmbedBuilder()
            .setTitle('🛡️  RESET REJECTED')
            .setDescription(
              '**The vote failed — leaderboard stays as-is.**\n\n' +
              '```  YES  ' + yesCount + '  |  NO  ' + noCount + '```'
            )
            .setColor(0x57f287)
            .setTimestamp();
          await msg.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
        }
      });
      return;
    }

    // /rank
    if (interaction.isChatInputCommand() && interaction.commandName === 'rank') {
      const pts = loadPoints();
      const data = pts[interaction.user.id];
      const rank = getRank(interaction.user.id);

      const points = data?.pts || 0;
      const wins = data?.wins || 0;
      const losses = data?.losses || 0;
      const mvps = data?.mvps || 0;
      const matches = data?.matches || 0;
      const winRate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : 0;

      const statBar = createStatBar(points);

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${interaction.user.username}'s Stats`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setDescription(`**${statBar}**`)
        .addFields(
          { name: '💯 POINTS', value: `\`${points}\``, inline: true },
          { name: '✅ WINS', value: `\`${wins}\``, inline: true },
          { name: '❌ LOSSES', value: `\`${losses}\``, inline: true },
          { name: '👑 MVPs', value: `\`${mvps}\``, inline: true },
          { name: '🎮 MATCHES', value: `\`${matches}\``, inline: true },
          { name: '📈 WIN RATE', value: `\`${winRate}%\``, inline: true },
        )
        .setColor(rank ? 0x5865f2 : 0x99aab5)
        .setFooter({ text: rank ? `🏅 Rank #${rank}` : '🔓 Unranked' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Modal: play setup
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

    // Modal: join key
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

    // BUTTONS
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Join Team 1 or 2
      if (customId.startsWith('join1_') || customId.startsWith('join2_')) {
        const teamNum = customId.startsWith('join1_') ? 1 : 2;
        const gameId = customId.split('_')[1];
        const game = games.get(gameId);

        if (!game) return interaction.reply({ content: '❌ Lobby expired!', ephemeral: true });
        if (game.status !== 'lobby') return interaction.reply({ content: '❌ Match already started!', ephemeral: true });

        // CHECK IF IN WAITING VC
        const inWaiting = await isInWaiting(interaction.guild, interaction.user.id);
        if (!inWaiting) {
          return interaction.reply({
            content: `❌ You must be in **${WAITING_VC_NAME}** to join a match!`,
            ephemeral: true,
          });
        }

        const allPlayers = [...game.team1, ...game.team2];
        if (allPlayers.some(u => u.id === interaction.user.id)) {
          return interaction.reply({ content: '❌ You are already in this lobby!', ephemeral: true });
        }

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

      // Start (host only)
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

      // MVP Vote
      if (customId.startsWith('mvpwin_') || customId.startsWith('mvplose_')) {
        const parts = customId.split('_');
        const voteType = parts[1];
        const gameId = parts[2];
        const game = games.get(gameId);

        if (!game) return interaction.reply({ content: '❌ Match expired!', ephemeral: true });

        if (interaction.user.id !== game.host.id) {
          return interaction.reply({ content: '❌ Only the **host** can vote! (Admins use `/set` command)', ephemeral: true });
        }

        if (!game.votes[interaction.user.id]) game.votes[interaction.user.id] = { win: null, lose: null };

        if (voteType === 'win' && game.votes[interaction.user.id].win) {
          return interaction.reply({ content: '❌ You already selected MVP Winner!', ephemeral: true });
        }
        if (voteType === 'lose' && game.votes[interaction.user.id].lose) {
          return interaction.reply({ content: '❌ You already selected MVP Loser!', ephemeral: true });
        }

        await interaction.reply({
          content: `✅ Vote recorded for **${voteType === 'win' ? '👑 MVP Winner' : '💀 MVP Loser'}**!`,
          ephemeral: true,
        });
      }
    }

    // SELECT MENU
    if (interaction.isStringSelectMenu()) {
      const { customId } = interaction;

      if (customId.startsWith('vote_win_') || customId.startsWith('vote_lose_')) {
        const parts = customId.split('_');
        const voteType = parts[1];
        const gameId = parts[2];
        const game = games.get(gameId);

        if (!game) return interaction.reply({ content: '❌ Match expired!', ephemeral: true });

        if (interaction.user.id !== game.host.id) {
          return interaction.reply({ content: '❌ Only the **host** can vote!', ephemeral: true });
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
          await tallyVotes(game, interaction.guild);
        }

        await interaction.reply({
          content:
            `✅ Voted! You selected **${selectedPlayer?.username || 'Unknown'}** as ` +
            `${voteType === 'win' ? '👑 MVP Winner' : '💀 MVP Loser'}`,
          ephemeral: true,
        });
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

    const category = await guild.channels.create({
      name: `Match • ${game.roomID}`,
      type: ChannelType.GuildCategory,
    });

    const vc1 = await guild.channels.create({ name: '🔴 Team 1', type: ChannelType.GuildVoice, parent: category.id });
    const vc2 = await guild.channels.create({ name: '🟢 Team 2', type: ChannelType.GuildVoice, parent: category.id });

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

    const dm =
      `🎮 **Match Starting!**\n\n` +
      `📋 Room ID: \`${game.roomID}\`\n` +
      `🔑 Password: \`${game.roomPass}\`` +
      (game.joinKey ? `\n🗝️ Key: \`${game.joinKey}\`` : '');

    for (const u of allPlayers) await u.send(dm).catch(() => {});

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

    await lobbyMessage.delete().catch(() => {});

    console.log(`✅ Match started: ${game.roomID}`);
  } catch (err) {
    console.error('❌ startMatch error:', err);
  }
}

// ── POST VOTE MENUS ────────────────────────────────────────
async function postVotes(game) {
  const allPlayers = [...game.team1, ...game.team2];

  const embed = new EmbedBuilder()
    .setTitle('🗳️ MVP VOTE')
    .setDescription(
      `**Only Host votes**\n\n` +
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
