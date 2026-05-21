require("dotenv").config();
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
  AttachmentBuilder,
} = require("discord.js");
const fs = require("fs");
const { createCanvas, loadImage, registerFont } = require("canvas");
const https = require("https");
const path = require("path");

// ── CONFIG ─────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const POINTS_FILE = "./points.json";

const ADMIN_ROLES = [
  "OWNERSHIP",
  "/C",
  "/Agent",
  "/Q",
  "Server Developer",
  "System Bots",
  "Bots",
  "/EspControl",
];
const WAITING_VC_NAME = "⌛・Waiting";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID in .env");
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
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, "{}");
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
    member.roles.cache.some((r) => ADMIN_ROLES.includes(r.name))
  );
}

async function isInWaiting(guild, userId) {
  const member = await guild.members
    .fetch({ user: userId, force: true })
    .catch(() => null);
  if (!member?.voice?.channel) return false;
  return member.voice.channel.name === WAITING_VC_NAME;
}

function getWaitingVC(guild) {
  return (
    guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name === WAITING_VC_NAME,
    ) || null
  );
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

// ── DOWNLOAD IMAGE ─────────────────────────────────────────
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 5000 }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

// ── GENERATE LEADERBOARD IMAGE ─────────────────────────────
async function generateLeaderboardImage() {
  const pts = loadPoints();
  const sorted = Object.entries(pts)
    .filter(([, v]) => v.pts > 0)
    .sort((a, b) => b[1].pts - a[1].pts)
    .slice(0, 10);

  const width = 1200;
  const height = 100 + sorted.length * 100;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#1a1a2e");
  gradient.addColorStop(1, "#16213e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 48px Arial";
  ctx.textAlign = "center";
  ctx.fillText("🏆 LEADERBOARD 🏆", width / 2, 60);

  // Headers
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "left";
  ctx.fillText("RANK", 20, 110);
  ctx.fillText("PLAYER", 120, 110);
  ctx.fillText("W/L", 700, 110);
  ctx.fillText("MVP", 850, 110);
  ctx.fillText("POINTS", 950, 110);

  // Separator line
  ctx.strokeStyle = "#ffd700";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 130);
  ctx.lineTo(width - 20, 130);
  ctx.stroke();

  // Rows
  let yPos = 160;
  const medals = ["🥇", "🥈", "🥉"];

  for (let i = 0; i < sorted.length; i++) {
    const [userId, data] = sorted[i];
    const rank = i + 1;
    const medal = medals[i] || `#${rank}`;

    // Row background (alternating)
    ctx.fillStyle =
      i % 2 === 0 ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 215, 0, 0.05)";
    ctx.fillRect(20, yPos - 35, width - 40, 85);

    // Rank
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "left";
    ctx.fillText(medal, 30, yPos);

    // Player name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial";
    ctx.fillText(data.username.substring(0, 25), 120, yPos);

    // W/L
    ctx.fillStyle = "#87ceeb";
    ctx.font = "20px Arial";
    ctx.fillText(`${data.wins}W/${data.losses}L`, 700, yPos);

    // MVP
    ctx.fillStyle = "#ff69b4";
    ctx.fillText(String(data.mvps), 850, yPos);

    // Points
    ctx.fillStyle = "#00ff00";
    ctx.font = "bold 24px Arial";
    ctx.fillText(String(data.pts), 950, yPos);

    yPos += 100;
  }

  return canvas.createPNGStream();
}

// ── GENERATE STATS CARD ────────────────────────────────────
async function generateStatsCard(user, data, rank) {
  const W = 900;
  const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0f0c29");
  bg.addColorStop(0.5, "#1a1a3e");
  bg.addColorStop(1, "#24243e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Glowing side accent bar
  const accent = ctx.createLinearGradient(0, 0, 0, H);
  accent.addColorStop(0, "#ffd700");
  accent.addColorStop(1, "#ff6b00");
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 6, H);

  // Avatar circle
  const avatarX = 150;
  const avatarY = 150;
  const avatarR = 80;
  try {
    const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
    const imgBuffer = await downloadImage(avatarUrl);
    const img = await loadImage(imgBuffer);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, avatarX - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2);
    ctx.restore();
  } catch {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.fillStyle = "#2c2c54";
    ctx.fill();
    ctx.restore();
  }

  // Avatar border ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarR + 4, 0, Math.PI * 2);
  ctx.strokeStyle = rank && rank <= 3 ? "#ffd700" : "#5865f2";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Rank badge below avatar
  if (rank) {
    ctx.fillStyle = rank <= 3 ? "#ffd700" : "#5865f2";
    ctx.beginPath();
    ctx.roundRect(avatarX - 40, avatarY + avatarR + 10, 80, 28, 14);
    ctx.fill();
    ctx.fillStyle = rank <= 3 ? "#000" : "#fff";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`RANK #${rank}`, avatarX, avatarY + avatarR + 29);
  } else {
    ctx.fillStyle = "#555577";
    ctx.beginPath();
    ctx.roundRect(avatarX - 40, avatarY + avatarR + 10, 80, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#aaaacc";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("UNRANKED", avatarX, avatarY + avatarR + 29);
  }

  // Username
  ctx.textAlign = "left";
  ctx.font = "bold 32px Arial";
  ctx.fillStyle = "#ffffff";
  const displayUser = user.displayName || user.username;
  ctx.fillText(displayUser.substring(0, 18), 290, 65);

  // Subtitle separator line
  ctx.strokeStyle = "rgba(255,215,0,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(290, 78);
  ctx.lineTo(880, 78);
  ctx.stroke();

  // Stat grid — 3 columns x 2 rows
  const stats = [
    { label: "POINTS", value: String(data.pts || 0), color: "#00ff99" },
    { label: "WINS", value: String(data.wins || 0), color: "#4ade80" },
    { label: "LOSSES", value: String(data.losses || 0), color: "#f87171" },
    { label: "MVPs", value: String(data.mvps || 0), color: "#ffd700" },
    { label: "MATCHES", value: String(data.matches || 0), color: "#60a5fa" },
    {
      label: "WIN RATE",
      value:
        (data.matches || 0) > 0
          ? `${(((data.wins || 0) / data.matches) * 100).toFixed(1)}%`
          : "0%",
      color: "#c084fc",
    },
  ];

  const colW = 196;
  const rowH = 90;
  const startX = 290;
  const startY = 100;

  for (let i = 0; i < stats.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * colW;
    const y = startY + row * rowH;

    // Card background
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(x, y, colW - 10, rowH - 10, 8);
    ctx.fill();

    // Value
    ctx.fillStyle = stats[i].color;
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(stats[i].value, x + (colW - 10) / 2, y + 38);

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "12px Arial";
    ctx.fillText(stats[i].label, x + (colW - 10) / 2, y + 60);
  }

  return canvas.toBuffer("image/png");
}

// ── POINTS SYSTEM ──────────────────────────────────────────
async function awardPoints(guild, target, result, channel, game = null) {
  const pts = loadPoints();
  if (!pts[target.id])
    pts[target.id] = {
      username: target.username,
      pts: 0,
      wins: 0,
      losses: 0,
      mvps: 0,
      matches: 0,
    };

  if (result === "win") {
    pts[target.id].pts += 100;
    pts[target.id].mvps += 1;
    pts[target.id].wins += 1;
    pts[target.id].matches += 1;
    pts[target.id].username = target.username;

    if (game) {
      const team = game.team1.some((u) => u.id === target.id)
        ? game.team1
        : game.team2;
      for (const u of team) {
        if (u.id === target.id) continue;
        if (!pts[u.id])
          pts[u.id] = {
            username: u.username,
            pts: 0,
            wins: 0,
            losses: 0,
            mvps: 0,
            matches: 0,
          };
        pts[u.id].pts += 50;
        pts[u.id].wins += 1;
        pts[u.id].matches += 1;
        pts[u.id].username = u.username;
      }
    }
    savePoints(pts);

    if (channel) {
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🏆 MVP WINNER")
              .setDescription(
                `**${displayName(target)}**\n\n` +
                  `🥇 MVP: **+100 pts**\n` +
                  `👥 Teammates: **+50 pts** each`,
              )
              .setColor(0xffd700),
          ],
        })
        .catch(() => {});
    }
  } else {
    pts[target.id].pts += 50;
    pts[target.id].mvps += 1;
    pts[target.id].losses += 1;
    pts[target.id].matches += 1;
    pts[target.id].username = target.username;

    if (game) {
      const team = game.team1.some((u) => u.id === target.id)
        ? game.team1
        : game.team2;
      for (const u of team) {
        if (u.id === target.id) continue;
        if (!pts[u.id])
          pts[u.id] = {
            username: u.username,
            pts: 0,
            wins: 0,
            losses: 0,
            mvps: 0,
            matches: 0,
          };
        pts[u.id].pts += 20;
        pts[u.id].losses += 1;
        pts[u.id].matches += 1;
        pts[u.id].username = u.username;
      }
    }
    savePoints(pts);

    if (channel) {
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎖️ MVP LOSER")
              .setDescription(
                `**${displayName(target)}**\n\n` +
                  `🥈 MVP: **+50 pts**\n` +
                  `👥 Teammates: **+20 pts** each`,
              )
              .setColor(0x99aab5),
          ],
        })
        .catch(() => {});
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
    .setName("play")
    .setDescription("Create a Free Fire match lobby (must be in ⌛・Waiting)")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Match mode")
        .setRequired(true)
        .addChoices(
          { name: "2v2", value: "2v2" },
          { name: "3v3", value: "3v3" },
          { name: "4v4", value: "4v4" },
          { name: "6v6", value: "6v6" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("set")
    .setDescription("Award MVP points (admin only)")
    .addUserOption((o) =>
      o.setName("player").setDescription("The MVP player").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("result")
        .setDescription("Win or lose?")
        .setRequired(true)
        .addChoices(
          { name: "Win", value: "win" },
          { name: "Lose", value: "lose" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("cancelmatch")
    .setDescription("Force cancel a match (admin only)")
    .addStringOption((o) =>
      o
        .setName("roomid")
        .setDescription("Room ID of the match")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top 10 players as image"),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Check your rank and points"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show a visual rank card for a player")
    .addUserOption((o) =>
      o
        .setName("player")
        .setDescription("Player to check (leave blank for yourself)")
        .setRequired(false),
    ),
].map((c) => c.toJSON());

// ── READY ──────────────────────────────────────────────────
client.on("ready", async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands registered");
  } catch (err) {
    console.error("❌ Command register error:", err);
  }
});

// ── VOICE STATE UPDATE ─────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guild = oldState.guild;
    const userId = oldState.id;

    if (botMoving.has(userId)) return;

    let playerGame = null;
    for (const [, g] of games) {
      if (g.status !== "started") continue;
      if ([...g.team1, ...g.team2].some((u) => u.id === userId)) {
        playerGame = g;
        break;
      }
    }
    if (!playerGame) return;

    const expectedVC = playerGame.team1.some((u) => u.id === userId)
      ? playerGame.vc1
      : playerGame.vc2;
    if (!expectedVC) return;

    if (
      oldState.channelId === expectedVC.id &&
      newState.channelId !== expectedVC.id
    ) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      const until = new Date(Date.now() + 15 * 60 * 1000);
      await member
        .disableCommunicationUntil(
          until,
          "Left team voice channel during active match",
        )
        .catch(() => {});

      await member.user
        .send(
          `⚠️ **Warning!**\n\nYou left your team voice channel during an active match.\nYou have been **timed out for 15 minutes**.`,
        )
        .catch(() => {});

      console.log(`⚠️ Timed out ${member.user.username} for leaving team VC`);
    }
  } catch (err) {
    console.error("voiceStateUpdate error:", err);
  }
});

// ── INTERACTIONS ───────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {
    // /play
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "play"
    ) {
      const inWaiting = await isInWaiting(
        interaction.guild,
        interaction.user.id,
      );
      if (!inWaiting) {
        return interaction.reply({
          content: `❌ You must be in **${WAITING_VC_NAME}** to create a match!`,
          ephemeral: true,
        });
      }

      const mode = interaction.options.getString("mode");
      const gameId = genId();

      const modal = new ModalBuilder()
        .setCustomId(`playmodal_${mode}_${gameId}`)
        .setTitle(`🎮 Free Fire ${mode} — Match Setup`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("roomID")
            .setLabel("Room ID")
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("roomPass")
            .setLabel("Room Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("joinKey")
            .setLabel("Join Key (leave blank = open lobby)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false),
        ),
      );

      return interaction.showModal(modal);
    }

    // /set (admin only)
    if (interaction.isChatInputCommand() && interaction.commandName === "set") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ You do not have permission!",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("player");
      const result = interaction.options.getString("result");

      let playerGame = null;
      for (const [, g] of games) {
        if ([...g.team1, ...g.team2].some((u) => u.id === target.id)) {
          playerGame = g;
          break;
        }
      }

      await awardPoints(
        interaction.guild,
        target,
        result,
        interaction.channel,
        playerGame,
      );

      if (playerGame) {
        await moveToWaiting(interaction.guild, playerGame);
        await cleanupGame(playerGame);
      }

      return interaction.reply({
        content: `✅ Points awarded to **${target.username}**!`,
        ephemeral: true,
      });
    }

    // /cancelmatch (admin only)
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "cancelmatch"
    ) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ You do not have permission!",
          ephemeral: true,
        });
      }

      const roomId = interaction.options.getString("roomid");
      let found = null;
      for (const [, g] of games) {
        if (g.roomID === roomId) {
          found = g;
          break;
        }
      }

      if (!found)
        return interaction.reply({
          content: `❌ No active match with Room ID \`${roomId}\``,
          ephemeral: true,
        });

      await moveToWaiting(interaction.guild, found);
      await cleanupGame(found);

      return interaction.reply({
        content: `✅ Match \`${roomId}\` cancelled and players moved back.`,
        ephemeral: true,
      });
    }

    // /leaderboard (TOP 10 as IMAGE)
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "leaderboard"
    ) {
      await interaction.deferReply();

      try {
        const stream = await generateLeaderboardImage();
        const buffer = await new Promise((resolve, reject) => {
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", reject);
        });

        const attachment = new AttachmentBuilder(buffer, {
          name: "leaderboard.png",
        });
        return interaction.editReply({ files: [attachment] });
      } catch (err) {
        console.error("❌ Leaderboard image error:", err);
        return interaction.editReply({
          content: "❌ Failed to generate leaderboard image.",
        });
      }
    }

    // /rank
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "rank"
    ) {
      const pts = loadPoints();
      const data = pts[interaction.user.id];
      const rank = getRank(interaction.user.id);

      const points = data?.pts || 0;
      const wins = data?.wins || 0;
      const losses = data?.losses || 0;
      const mvps = data?.mvps || 0;
      const matches = data?.matches || 0;
      const winRate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : 0;

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${interaction.user.username}'s Stats`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "💯 POINTS", value: `${points}`, inline: true },
          { name: "✅ WINS", value: `${wins}`, inline: true },
          { name: "❌ LOSSES", value: `${losses}`, inline: true },
          { name: "👑 MVPs", value: `${mvps}`, inline: true },
          { name: "🎮 MATCHES", value: `${matches}`, inline: true },
          { name: "📈 WIN RATE", value: `${winRate}%`, inline: true },
        )
        .setColor(rank ? 0x5865f2 : 0x99aab5)
        .setFooter({ text: rank ? `🏅 Rank #${rank}` : "🔓 Unranked" })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /stats — visual rank card
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "stats"
    ) {
      await interaction.deferReply();

      const target = interaction.options.getUser("player") || interaction.user;
      const pts = loadPoints();
      const data = pts[target.id] || {
        pts: 0,
        wins: 0,
        losses: 0,
        mvps: 0,
        matches: 0,
        username: target.username,
      };
      const rank = getRank(target.id);

      try {
        const buffer = await generateStatsCard(target, data, rank);
        const attachment = new AttachmentBuilder(buffer, {
          name: "stats.png",
        });
        return interaction.editReply({ files: [attachment] });
      } catch (err) {
        console.error("❌ Stats card error:", err);
        return interaction.editReply({
          content: "❌ Failed to generate stats card.",
        });
      }
    }

    // Modal: play setup
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("playmodal_")
    ) {
      const parts = interaction.customId.split("_");
      const mode = parts[1];
      const gameId = parts[2];
      const teamSize = parseInt(mode.split("v")[0]);

      const roomID = interaction.fields.getTextInputValue("roomID").trim();
      const roomPass = interaction.fields.getTextInputValue("roomPass").trim();
      const joinKey =
        interaction.fields.getTextInputValue("joinKey").trim() || null;

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
        status: "lobby",
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

      return interaction.reply({
        content: "✅ Lobby created!",
        ephemeral: true,
      });
    }

    // Modal: join key
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("keymodal_")
    ) {
      const parts = interaction.customId.split("_");
      const gameId = parts[1];
      const teamNum = parseInt(parts[2]);
      const game = games.get(gameId);

      if (!game)
        return interaction.reply({
          content: "❌ Lobby expired!",
          ephemeral: true,
        });

      const entered = interaction.fields.getTextInputValue("keyInput").trim();
      if (entered !== game.joinKey) {
        return interaction.reply({
          content: "❌ Wrong key! You cannot join this match.",
          ephemeral: true,
        });
      }

      return addToTeam(interaction, game, teamNum, true);
    }

    // BUTTONS
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Join Team 1 or 2
      if (customId.startsWith("join1_") || customId.startsWith("join2_")) {
        const teamNum = customId.startsWith("join1_") ? 1 : 2;
        const gameId = customId.split("_")[1];
        const game = games.get(gameId);

        if (!game)
          return interaction.reply({
            content: "❌ Lobby expired!",
            ephemeral: true,
          });
        if (game.status !== "lobby")
          return interaction.reply({
            content: "❌ Match already started!",
            ephemeral: true,
          });

        // CHECK IF IN WAITING VC
        const inWaiting = await isInWaiting(
          interaction.guild,
          interaction.user.id,
        );
        if (!inWaiting) {
          return interaction.reply({
            content: `❌ You must be in **${WAITING_VC_NAME}** to join a match!`,
            ephemeral: true,
          });
        }

        const allPlayers = [...game.team1, ...game.team2];
        if (allPlayers.some((u) => u.id === interaction.user.id)) {
          return interaction.reply({
            content: "❌ You are already in this lobby!",
            ephemeral: true,
          });
        }

        if (game.joinKey && interaction.user.id !== game.host.id) {
          const modal = new ModalBuilder()
            .setCustomId(`keymodal_${gameId}_${teamNum}`)
            .setTitle("🔑 Enter Join Key");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("keyInput")
                .setLabel("Join Key")
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
            ),
          );
          return interaction.showModal(modal);
        }

        return addToTeam(interaction, game, teamNum, false);
      }

      // Leave
      if (customId === "leave") {
        const gameId = [...games.keys()].find(
          (id) => games.get(id).messageId === interaction.message.id,
        );
        const game = games.get(gameId);
        if (!game)
          return interaction.reply({
            content: "❌ Lobby not found!",
            ephemeral: true,
          });
        if (interaction.user.id === game.host.id)
          return interaction.reply({
            content: "❌ Host cannot leave! Cancel instead.",
            ephemeral: true,
          });

        game.team1 = game.team1.filter((u) => u.id !== interaction.user.id);
        game.team2 = game.team2.filter((u) => u.id !== interaction.user.id);

        await interaction.message.edit({
          embeds: [lobbyEmbed(game)],
          components: [lobbyButtons(game.gameId)],
        });
        return interaction.deferUpdate();
      }

      // Cancel (host only)
      if (customId === "cancel") {
        const gameId = [...games.keys()].find(
          (id) => games.get(id).messageId === interaction.message.id,
        );
        const game = games.get(gameId);
        if (!game)
          return interaction.reply({
            content: "❌ Lobby not found!",
            ephemeral: true,
          });
        if (interaction.user.id !== game.host.id)
          return interaction.reply({
            content: "❌ Only the host can cancel!",
            ephemeral: true,
          });

        games.delete(gameId);
        await interaction.message.delete().catch(() => {});
        return interaction.deferUpdate();
      }

      // Start (host only)
      if (customId === "start") {
        const gameId = [...games.keys()].find(
          (id) => games.get(id).messageId === interaction.message.id,
        );
        const game = games.get(gameId);
        if (!game)
          return interaction.reply({
            content: "❌ Lobby not found!",
            ephemeral: true,
          });
        if (interaction.user.id !== game.host.id)
          return interaction.reply({
            content: "❌ Only the host can start!",
            ephemeral: true,
          });
        if (
          game.team1.length < game.teamSize ||
          game.team2.length < game.teamSize
        ) {
          return interaction.reply({
            content: "❌ Both teams must be full to start!",
            ephemeral: true,
          });
        }

        game.status = "started";
        await interaction.deferUpdate();
        return startMatch(game, interaction.guild, interaction.message);
      }

      // End Match (host only)
      if (customId.startsWith("endmatch_")) {
        const gameId = customId.replace("endmatch_", "");
        const game = games.get(gameId);
        if (!game)
          return interaction.reply({
            content: "❌ Match not found!",
            ephemeral: true,
          });
        if (interaction.user.id !== game.host.id)
          return interaction.reply({
            content: "❌ Only the host can end the match!",
            ephemeral: true,
          });

        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Match Ended")
              .setDescription("Voting is now open!")
              .setColor(0x57f287),
          ],
          components: [],
        });
        return postVotes(game);
      }

      // MVP Vote
      if (customId.startsWith("mvpwin_") || customId.startsWith("mvplose_")) {
        const parts = customId.split("_");
        const voteType = parts[1];
        const gameId = parts[2];
        const game = games.get(gameId);

        if (!game)
          return interaction.reply({
            content: "❌ Match expired!",
            ephemeral: true,
          });

        if (interaction.user.id !== game.host.id) {
          return interaction.reply({
            content:
              "❌ Only the **host** can vote! (Admins use `/set` command)",
            ephemeral: true,
          });
        }

        if (!game.votes[interaction.user.id])
          game.votes[interaction.user.id] = { win: null, lose: null };

        if (voteType === "win" && game.votes[interaction.user.id].win) {
          return interaction.reply({
            content: "❌ You already selected MVP Winner!",
            ephemeral: true,
          });
        }
        if (voteType === "lose" && game.votes[interaction.user.id].lose) {
          return interaction.reply({
            content: "❌ You already selected MVP Loser!",
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: `✅ Vote recorded for **${voteType === "win" ? "👑 MVP Winner" : "💀 MVP Loser"}**!`,
          ephemeral: true,
        });
      }
    }

    // SELECT MENU
    if (interaction.isStringSelectMenu()) {
      const { customId } = interaction;

      if (
        customId.startsWith("vote_win_") ||
        customId.startsWith("vote_lose_")
      ) {
        const parts = customId.split("_");
        const voteType = parts[1];
        const gameId = parts[2];
        const game = games.get(gameId);

        if (!game)
          return interaction.reply({
            content: "❌ Match expired!",
            ephemeral: true,
          });

        if (interaction.user.id !== game.host.id) {
          return interaction.reply({
            content: "❌ Only the **host** can vote!",
            ephemeral: true,
          });
        }

        const selectedId = interaction.values[0];
        const allPlayers = [...game.team1, ...game.team2];
        const selectedPlayer = allPlayers.find((u) => u.id === selectedId);

        if (!game.votes[interaction.user.id])
          game.votes[interaction.user.id] = { win: null, lose: null };

        if (voteType === "win" && game.votes[interaction.user.id].win) {
          return interaction.reply({
            content: "❌ You already voted for MVP Winner!",
            ephemeral: true,
          });
        }
        if (voteType === "lose" && game.votes[interaction.user.id].lose) {
          return interaction.reply({
            content: "❌ You already voted for MVP Loser!",
            ephemeral: true,
          });
        }

        game.votes[interaction.user.id][voteType] = selectedId;

        if (
          game.votes[interaction.user.id].win &&
          game.votes[interaction.user.id].lose
        ) {
          game.playerVoted.add(interaction.user.id);
          await tallyVotes(game, interaction.guild);
        }

        await interaction.reply({
          content:
            `✅ Voted! You selected **${selectedPlayer?.username || "Unknown"}** as ` +
            `${voteType === "win" ? "👑 MVP Winner" : "💀 MVP Loser"}`,
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Something went wrong. Try again.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

// ── ADD TO TEAM ────────────────────────────────────────────
async function addToTeam(interaction, game, teamNum, fromModal) {
  const team = teamNum === 1 ? game.team1 : game.team2;

  if (team.length >= game.teamSize) {
    return interaction.reply({
      content: `❌ Team ${teamNum} is full!`,
      ephemeral: true,
    });
  }

  team.push(interaction.user);

  const msg = await interaction.channel.messages
    .fetch(game.messageId)
    .catch(() => null);
  if (msg)
    await msg.edit({
      embeds: [lobbyEmbed(game)],
      components: [lobbyButtons(game.gameId)],
    });

  if (fromModal) {
    return interaction.reply({
      content: `✅ You joined Team ${teamNum}!`,
      ephemeral: true,
    });
  } else {
    return interaction.deferUpdate();
  }
}

// ── START MATCH ────────────────────────────────────────────
async function startMatch(game, guild, lobbyMessage) {
  try {
    const allPlayers = [...game.team1, ...game.team2];
    const adminRole = guild.roles.cache.find((r) => r.name === "/EspControl");

    const category = await guild.channels.create({
      name: `Match • ${game.roomID}`,
      type: ChannelType.GuildCategory,
    });

    const vc1 = await guild.channels.create({
      name: "🔴 Team 1",
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
    const vc2 = await guild.channels.create({
      name: "🟢 Team 2",
      type: ChannelType.GuildVoice,
      parent: category.id,
    });

    const perms = [
      {
        id: guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...allPlayers.map((u) => ({
        id: u.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        deny: [PermissionsBitField.Flags.SendMessages],
      })),
    ];
    if (adminRole) {
      perms.push({
        id: adminRole.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      });
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
      (game.joinKey ? `\n🗝️ Key: \`${game.joinKey}\`` : "");

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
      .setTitle("🎮 Match in Progress")
      .setDescription(
        `**Mode:** ${game.mode.toUpperCase()}\n` +
          `**Room:** \`${game.roomID}\`\n\n` +
          `When the match ends, **host clicks End Match** to open voting.\n` +
          `Admins can use \`/set @player mvp win/lose\` to manually award.`,
      )
      .addFields(
        {
          name: "🔴 Team 1",
          value: game.team1.map((u) => displayName(u)).join("\n"),
          inline: true,
        },
        {
          name: "🟢 Team 2",
          value: game.team2.map((u) => displayName(u)).join("\n"),
          inline: true,
        },
      )
      .setColor(0x5865f2);

    await voteChannel.send({
      embeds: [matchEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`endmatch_${game.gameId}`)
            .setLabel("🏁 End Match")
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });

    await lobbyMessage.delete().catch(() => {});

    console.log(`✅ Match started: ${game.roomID}`);
  } catch (err) {
    console.error("❌ startMatch error:", err);
  }
}

// ── POST VOTE MENUS ────────────────────────────────────────
async function postVotes(game) {
  const allPlayers = [...game.team1, ...game.team2];

  const embed = new EmbedBuilder()
    .setTitle("🗳️ MVP VOTE")
    .setDescription(
      `**Only Host votes**\n\n` +
        `🔴 **Team 1:** ${game.team1.map((u) => u.username).join(", ")}\n` +
        `🟢 **Team 2:** ${game.team2.map((u) => u.username).join(", ")}\n\n` +
        `Select **MVP Winner** 👑 and **MVP Loser** 💀 from the dropdowns below.`,
    )
    .setColor(0xffd700);

  const options = allPlayers.map((u) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(u.username)
      .setValue(u.id)
      .setDescription(`Vote for ${u.username}`),
  );

  const winMenu = new StringSelectMenuBuilder()
    .setCustomId(`vote_win_${game.gameId}`)
    .setPlaceholder("👑 Select MVP Winner")
    .addOptions(options);

  const loseMenu = new StringSelectMenuBuilder()
    .setCustomId(`vote_lose_${game.gameId}`)
    .setPlaceholder("💀 Select MVP Loser")
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
  const mvpLoseId = Object.entries(loseTally).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];

  const mvpWin = mvpWinId ? allPlayers.find((u) => u.id === mvpWinId) : null;
  const mvpLose = mvpLoseId ? allPlayers.find((u) => u.id === mvpLoseId) : null;

  if (mvpWin) await awardPoints(guild, mvpWin, "win", game.voteChannel, game);
  if (mvpLose)
    await awardPoints(guild, mvpLose, "lose", game.voteChannel, game);

  await game.voteChannel.send(
    "✅ Voting complete! Moving everyone back to waiting in 5 seconds...",
  );
  await new Promise((r) => setTimeout(r, 5000));

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
  await new Promise((r) => setTimeout(r, 1000));
  if (game.voteChannel) await game.voteChannel.delete().catch(() => {});
  if (game.vc1) await game.vc1.delete().catch(() => {});
  if (game.vc2) await game.vc2.delete().catch(() => {});
  if (game.category) await game.category.delete().catch(() => {});
}

// ── LOBBY EMBED ────────────────────────────────────────────
function lobbyEmbed(game) {
  const fmt = (t) =>
    t.length ? t.map((u) => displayName(u)).join("\n") : "_Empty_";
  return new EmbedBuilder()
    .setTitle(`🐾 Free Fire ${game.mode.toUpperCase()} — Lobby`)
    .setDescription(`Host: **${displayName(game.host)}**`)
    .addFields(
      {
        name: `🔴 Team 1 (${game.team1.length}/${game.teamSize})`,
        value: fmt(game.team1),
        inline: true,
      },
      {
        name: `🟢 Team 2 (${game.team2.length}/${game.teamSize})`,
        value: fmt(game.team2),
        inline: true,
      },
    )
    .setColor(0x2b2d31)
    .setFooter({
      text: game.joinKey
        ? "🔒 Key protected lobby"
        : "🔓 Open lobby — must be in ⌛・Waiting to join",
    });
}

// ── LOBBY BUTTONS ──────────────────────────────────────────
function lobbyButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join1_${gameId}`)
      .setLabel("Join Team 1 🔴")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`join2_${gameId}`)
      .setLabel("Join Team 2 🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("leave")
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("start")
      .setLabel("▶️ Start")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("❌ Cancel")
      .setStyle(ButtonStyle.Danger),
  );
}

// ── ERROR HANDLING ─────────────────────────────────────────
client.on("error", (err) => console.error("❌ Client error:", err));
process.on("unhandledRejection", (err) =>
  console.error("❌ Unhandled rejection:", err),
);

client.login(TOKEN);
