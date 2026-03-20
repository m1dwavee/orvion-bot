require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  Collection
} = require('discord.js');

console.log('HR + EVENT + MANAGEMENT TICKET SYSTEM + COMMAND BOT ACTIVE');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();

// ===== IDs =====
const CLIENT_ID = '1484192795777433680';
const GUILD_ID = '1475150576361803776';

const PANEL_CHANNEL_ID = '1483077963661574244';

// HR
const HR_CATEGORY_ID = '1475335652420620471';
const HRM_ROLE_ID = '1476659899961442407';
const HRT_ROLE_ID = '1476659748257402982';

// EVENT
const EVENT_CATEGORY_ID = '1475335652420620471';
const EVENT_MANAGER_ROLE_ID = '1482123095082012886';
const EVENT_TEAM_ROLE_ID = '1476658320009072707';

// MANAGEMENT
const MANAGEMENT_CATEGORY_ID = '1475335652420620471';
const FOUNDER_ROLE_ID = '1475225024511082637';
const PROJECT_MANAGER_ROLE_ID = '1482022945986580665';

// Aynı anda 2 ticket açılmasını engeller
const pendingTicketOpens = new Set();

// Simple in-memory warning system
// Format: warnings.get(guildId).get(userId) = [{ reason, moderator, timestamp }]
const warnings = new Map();

function getUserWarnings(guildId, userId) {
  if (!warnings.has(guildId)) warnings.set(guildId, new Map());
  const guildWarnings = warnings.get(guildId);
  if (!guildWarnings.has(userId)) guildWarnings.set(userId, []);
  return guildWarnings.get(userId);
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} minute(s)`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} hour(s)`;
  return `${hours} hour(s) ${remainingMinutes} minute(s)`;
}

// ===== HELPERS =====
function sanitizeChannelName(username) {
  const cleaned = username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 12);

  return cleaned || 'user';
}

function parseTicketTopic(topic) {
  if (!topic) {
    return { ownerId: null, claimedBy: null, type: null };
  }

  const ownerMatch = topic.match(/owner:(\d+)/);
  const claimedMatch = topic.match(/claimed:(\d+)/);
  const typeMatch = topic.match(/type:([a-z]+)/);

  return {
    ownerId: ownerMatch ? ownerMatch[1] : null,
    claimedBy: claimedMatch ? claimedMatch[1] : null,
    type: typeMatch ? typeMatch[1] : null
  };
}

function buildTicketTopic(ownerId, type, claimedBy = null) {
  let topic = `owner:${ownerId}|type:${type}`;
  if (claimedBy) topic += `|claimed:${claimedBy}`;
  return topic;
}

function isHrStaff(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.has(HRM_ROLE_ID) || member.roles.cache.has(HRT_ROLE_ID);
}

function isEventStaff(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.has(EVENT_MANAGER_ROLE_ID) || member.roles.cache.has(EVENT_TEAM_ROLE_ID);
}

function isManagementStaff(member) {
  if (!member?.roles?.cache) return false;
  return (
    member.roles.cache.has(FOUNDER_ROLE_ID) ||
    member.roles.cache.has(PROJECT_MANAGER_ROLE_ID)
  );
}

function canClaimTicket(member, type) {
  if (type === 'hr') return isHrStaff(member);
  if (type === 'event') return isEventStaff(member);
  if (type === 'management') return isManagementStaff(member);
  return false;
}

function canCloseTicket(member, userId, ownerId, type) {
  if (userId === ownerId) return true;
  if (type === 'hr') return isHrStaff(member);
  if (type === 'event') return isEventStaff(member);
  if (type === 'management') return isManagementStaff(member);
  return false;
}

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📩 Contact Panel')
    .setDescription(
`Please choose the ticket type below.

📩 HR Ticket
Use this for applications and HR-related topics.

🎉 Event Ticket
Use this for event management and event-related topics.

👑 Contact Management Team
You can open a ticket here to contact the founder and for partnerships.`
    )
    .setColor('#5865F2');
}

function buildPanelRow1() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open_hr')
      .setLabel('Open HR Ticket')
      .setEmoji('📩')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('ticket_open_event')
      .setLabel('Open Event Ticket')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
  );
}

function buildPanelRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open_management')
      .setLabel('Contact Management Team')
      .setEmoji('👑')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildTicketButtons(claimedBy = null, claimerName = null) {
  const claimLabel = claimedBy
    ? `Claimed by ${(claimerName || 'Staff').slice(0, 20)}`
    : 'Claim';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel(claimLabel)
      .setEmoji('🛄')
      .setStyle(claimedBy ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(Boolean(claimedBy)),

    new ButtonBuilder()
      .setCustomId('ticket_unclaim')
      .setLabel('Unclaim')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedBy),

    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );
}

async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const member = interaction.member;
  const userId = member.id;
  const pendingKey = `${type}-${userId}`;

  if (pendingTicketOpens.has(pendingKey)) {
    return interaction.reply({
      content: 'Your ticket is already being created. Please wait a moment.',
      ephemeral: true
    });
  }

  pendingTicketOpens.add(pendingKey);

  try {
    await interaction.deferReply({ ephemeral: true });
    await guild.channels.fetch();

    const existing = guild.channels.cache.find(c => {
      if (c.type !== ChannelType.GuildText) return false;

      const data = parseTicketTopic(c.topic);
      return data.ownerId === userId && data.type === type;
    });

    if (existing) {
      return interaction.editReply({
        content: `You already have an open ${type} ticket: ${existing}`
      });
    }

    let categoryId;
    let roleIds;
    let channelPrefix;
    let mentionText;
    let embedTitle;
    let embedDescription;
    let embedColor;

    if (type === 'hr') {
      categoryId = HR_CATEGORY_ID;
      roleIds = [HRM_ROLE_ID, HRT_ROLE_ID];
      channelPrefix = 'hr-ticket';
      mentionText = `${member} <@&${HRM_ROLE_ID}> <@&${HRT_ROLE_ID}>`;
      embedTitle = '📩 HR Ticket Created';
      embedDescription = `${member}, please describe your HR issue or application in detail.`;
      embedColor = '#57F287';
    } else if (type === 'event') {
      categoryId = EVENT_CATEGORY_ID;
      roleIds = [EVENT_MANAGER_ROLE_ID, EVENT_TEAM_ROLE_ID];
      channelPrefix = 'event-ticket';
      mentionText = `${member} <@&${EVENT_MANAGER_ROLE_ID}> <@&${EVENT_TEAM_ROLE_ID}>`;
      embedTitle = '🎉 Event Ticket Created';
      embedDescription = `${member}, please describe your event request in detail.`;
      embedColor = '#5865F2';
    } else {
      categoryId = MANAGEMENT_CATEGORY_ID;
      roleIds = [FOUNDER_ROLE_ID, PROJECT_MANAGER_ROLE_ID];
      channelPrefix = 'management-ticket';
      mentionText = `${member} <@&${FOUNDER_ROLE_ID}> <@&${PROJECT_MANAGER_ROLE_ID}>`;
      embedTitle = '👑 Management Ticket Created';
      embedDescription = `${member}, please describe your request, founder contact reason, or partnership offer in detail.`;
      embedColor = '#FEE75C';
    }

    const channelName = `${channelPrefix}-${sanitizeChannelName(interaction.user.username)}-${userId.slice(-4)}`;

    const permissionOverwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: userId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      }
    ];

    for (const roleId of roleIds) {
      permissionOverwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      });
    }

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: buildTicketTopic(userId, type),
      permissionOverwrites
    });

    const ticketEmbed = new EmbedBuilder()
      .setTitle(embedTitle)
      .setDescription(embedDescription)
      .setColor(embedColor)
      .setTimestamp();

    await ticketChannel.send({
      content: mentionText,
      embeds: [ticketEmbed],
      components: [buildTicketButtons()]
    });

    return interaction.editReply({
      content: `Your ${type} ticket has been created: ${ticketChannel}`
    });
  } catch (error) {
    console.error(`${type} ticket open error:`, error);

    if (interaction.deferred) {
      return interaction.editReply({
        content: `An error occurred while creating the ${type} ticket.`
      });
    }
  } finally {
    pendingTicketOpens.delete(pendingKey);
  }
}

// ===== SLASH COMMANDS =====
const ticketSlashCommands = [
  new SlashCommandBuilder()
    .setName('underreview')
    .setDescription('Send under review message'),

  new SlashCommandBuilder()
    .setName('rejected')
    .setDescription('Send rejected message'),

  new SlashCommandBuilder()
    .setName('accepted')
    .setDescription('Send accepted message'),

  new SlashCommandBuilder()
    .setName('sendpanel')
    .setDescription('Send the ticket panel')
];

const extraCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Replies with bot latency.'),

    async execute(interaction) {
      await interaction.reply(`Pong! ${interaction.client.ws.ping}ms`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('serverinfo')
      .setDescription('Shows information about this server.'),

    async execute(interaction) {
      const guild = interaction.guild;

      const embed = new EmbedBuilder()
        .setTitle('Server Information')
        .setColor('Blue')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: 'Server Name', value: guild.name, inline: true },
          { name: 'Server ID', value: guild.id, inline: true },
          { name: 'Member Count', value: `${guild.memberCount}`, inline: true },
          { name: 'Owner ID', value: guild.ownerId, inline: true },
          {
            name: 'Created At',
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
            inline: false,
          }
        );

      await interaction.reply({ embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Shows information about a user.')
      .addUserOption(option =>
        option
          .setName('target')
          .setDescription('Select a user')
          .setRequired(false)
      ),

    async execute(interaction) {
      const user = interaction.options.getUser('target') || interaction.user;
      const member = interaction.guild.members.cache.get(user.id);

      const embed = new EmbedBuilder()
        .setTitle('User Information')
        .setColor('Green')
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Username', value: user.tag, inline: true },
          { name: 'User ID', value: user.id, inline: true },
          { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
          {
            name: 'Account Created',
            value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`,
            inline: false,
          },
          {
            name: 'Joined Server',
            value: member?.joinedTimestamp
              ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
              : 'Not found',
            inline: false,
          }
        );

      await interaction.reply({ embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('say')
      .setDescription('Make the bot say something.')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('Message to send')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
      const message = interaction.options.getString('message');

      await interaction.deferReply({ ephemeral: true });
      await interaction.channel.send({ content: message });
      await interaction.editReply('Message sent.');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Delete a number of messages.')
      .addIntegerOption(option =>
        option
          .setName('amount')
          .setDescription('Number of messages to delete (1-100)')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');

      if (amount < 1 || amount > 100) {
        return interaction.reply({
          content: 'Please provide a number between 1 and 100.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.editReply(`Deleted ${deleted.size} message(s).`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Send an announcement embed.')
      .addStringOption(option =>
        option
          .setName('title')
          .setDescription('Announcement title')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('Announcement message')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
      const title = interaction.options.getString('title');
      const message = interaction.options.getString('message');

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(message)
        .setColor('Blue')
        .setFooter({ text: `Announcement by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.deferReply({ ephemeral: true });
      await interaction.channel.send({ embeds: [embed] });
      await interaction.editReply('Announcement sent successfully.');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Send a custom embed message.')
      .addStringOption(option =>
        option
          .setName('title')
          .setDescription('Embed title')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('Embed description')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('color')
          .setDescription('Embed color (Blue, Red, Green, Yellow, Purple, Orange)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color = interaction.options.getString('color') || 'Blue';

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: `Sent by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.deferReply({ ephemeral: true });
      await interaction.channel.send({ embeds: [embed] });
      await interaction.editReply('Embed sent successfully.');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Lock the current channel.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });

      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false }
      );

      await interaction.editReply('Channel locked successfully.');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock the current channel.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });

      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: true }
      );

      await interaction.editReply('Channel unlocked successfully.');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('roleadd')
      .setDescription('Add a role to a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('Select a user')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Select a role')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({ content: 'Member not found.', ephemeral: true });
      }

      if (member.roles.cache.has(role.id)) {
        return interaction.reply({
          content: 'This user already has that role.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      await member.roles.add(role);
      await interaction.editReply(`Role ${role.name} added to ${user.tag}.`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('roleremove')
      .setDescription('Remove a role from a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('Select a user')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Select a role')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({ content: 'Member not found.', ephemeral: true });
      }

      if (!member.roles.cache.has(role.id)) {
        return interaction.reply({
          content: 'This user does not have that role.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      await member.roles.remove(role);
      await interaction.editReply(`Role ${role.name} removed from ${user.tag}.`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to kick')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for the kick')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided.';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({ content: 'Member not found.', ephemeral: true });
      }

      if (!member.kickable) {
        return interaction.reply({
          content: 'I cannot kick this member. Check role positions and permissions.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      await member.kick(reason);
      await interaction.editReply(`Kicked ${user.tag}. Reason: ${reason}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to ban')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for the ban')
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('delete_days')
          .setDescription('Delete message history in days (0-7)')
          .setMinValue(0)
          .setMaxValue(7)
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided.';
      const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (member && !member.bannable) {
        return interaction.reply({
          content: 'I cannot ban this member. Check role positions and permissions.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      await interaction.guild.members.ban(user.id, {
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        reason,
      });

      await interaction.editReply(`Banned ${user.tag}. Reason: ${reason}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Timeout a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to timeout')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('minutes')
          .setDescription('Timeout duration in minutes')
          .setMinValue(1)
          .setMaxValue(40320)
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for the timeout')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const minutes = interaction.options.getInteger('minutes');
      const reason = interaction.options.getString('reason') || 'No reason provided.';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({ content: 'Member not found.', ephemeral: true });
      }

      if (!member.moderatable) {
        return interaction.reply({
          content: 'I cannot timeout this member. Check role positions and permissions.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      await member.timeout(minutes * 60 * 1000, reason);

      await interaction.editReply(
        `${user.tag} has been timed out for ${formatDuration(minutes)}. Reason: ${reason}`
      );
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('Remove a timeout from a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to remove timeout from')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for removing timeout')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided.';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({ content: 'Member not found.', ephemeral: true });
      }

      if (!member.moderatable) {
        return interaction.reply({
          content: 'I cannot remove timeout from this member.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      await member.timeout(null, reason);
      await interaction.editReply(`Removed timeout from ${user.tag}. Reason: ${reason}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to warn')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for the warning')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const userWarnings = getUserWarnings(interaction.guild.id, user.id);

      userWarnings.push({
        reason,
        moderator: interaction.user.tag,
        timestamp: Date.now(),
      });

      await interaction.reply({
        content: `${user.tag} has been warned. Total warnings: ${userWarnings.length}`,
        ephemeral: true,
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('Show warnings for a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to check')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const userWarnings = getUserWarnings(interaction.guild.id, user.id);

      if (userWarnings.length === 0) {
        return interaction.reply({
          content: `${user.tag} has no warnings.`,
          ephemeral: true,
        });
      }

      const description = userWarnings
        .map((warn, index) => {
          return `**#${index + 1}** - ${warn.reason}\nModerator: ${warn.moderator}\nDate: <t:${Math.floor(warn.timestamp / 1000)}:F>`;
        })
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${user.tag}`)
        .setDescription(description)
        .setColor('Orange')
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('removewarn')
      .setDescription('Remove a specific warning from a member.')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to edit')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('number')
          .setDescription('Warning number to remove')
          .setMinValue(1)
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const number = interaction.options.getInteger('number');
      const userWarnings = getUserWarnings(interaction.guild.id, user.id);

      if (userWarnings.length === 0) {
        return interaction.reply({
          content: `${user.tag} has no warnings.`,
          ephemeral: true,
        });
      }

      if (number < 1 || number > userWarnings.length) {
        return interaction.reply({
          content: `Invalid warning number. This user has ${userWarnings.length} warning(s).`,
          ephemeral: true,
        });
      }

      const removed = userWarnings.splice(number - 1, 1)[0];

      await interaction.reply({
        content: `Removed warning #${number} from ${user.tag}. Reason was: ${removed.reason}`,
        ephemeral: true,
      });
    },
  },
];

for (const command of extraCommands) {
  client.commands.set(command.data.name, command);
}

const allSlashCommands = [
  ...ticketSlashCommands.map(cmd => cmd.toJSON()),
  ...extraCommands.map(cmd => cmd.data.toJSON())
];

// ===== READY =====
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: allSlashCommands }
    );
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  try {
    // ===== BUTTONS =====
    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_open_hr') {
        return createTicket(interaction, 'hr');
      }

      if (interaction.customId === 'ticket_open_event') {
        return createTicket(interaction, 'event');
      }

      if (interaction.customId === 'ticket_open_management') {
        return createTicket(interaction, 'management');
      }

      if (interaction.customId === 'ticket_claim') {
        const channel = interaction.channel;
        const { ownerId, claimedBy, type } = parseTicketTopic(channel.topic);

        if (!ownerId || !type) {
          return interaction.reply({
            content: 'This is not a valid ticket.',
            ephemeral: true
          });
        }

        if (!canClaimTicket(interaction.member, type)) {
          return interaction.reply({
            content: 'You do not have permission to claim this ticket.',
            ephemeral: true
          });
        }

        if (claimedBy) {
          return interaction.reply({
            content: `This ticket is already claimed by <@${claimedBy}>.`,
            ephemeral: true
          });
        }

        await channel.setTopic(buildTicketTopic(ownerId, type, interaction.user.id));

        await interaction.update({
          components: [buildTicketButtons(interaction.user.id, interaction.user.username)]
        });

        const claimEmbed = new EmbedBuilder()
          .setTitle('🛄 Ticket Claimed')
          .setDescription(`This ${type} ticket has been claimed by ${interaction.user}.`)
          .setColor('#5865F2')
          .setTimestamp();

        await channel.send({
          embeds: [claimEmbed]
        });

        return;
      }

      if (interaction.customId === 'ticket_unclaim') {
        const channel = interaction.channel;
        const { ownerId, claimedBy, type } = parseTicketTopic(channel.topic);

        if (!ownerId || !type) {
          return interaction.reply({
            content: 'This is not a valid ticket.',
            ephemeral: true
          });
        }

        if (!canClaimTicket(interaction.member, type)) {
          return interaction.reply({
            content: 'You do not have permission to unclaim this ticket.',
            ephemeral: true
          });
        }

        if (!claimedBy) {
          return interaction.reply({
            content: 'This ticket is not claimed.',
            ephemeral: true
          });
        }

        if (claimedBy !== interaction.user.id && !isManagementStaff(interaction.member)) {
          return interaction.reply({
            content: 'Only the staff member who claimed this ticket or management can unclaim it.',
            ephemeral: true
          });
        }

        await channel.setTopic(buildTicketTopic(ownerId, type));

        await interaction.update({
          components: [buildTicketButtons()]
        });

        const unclaimEmbed = new EmbedBuilder()
          .setTitle('↩️ Ticket Unclaimed')
          .setDescription(`This ${type} ticket has been unclaimed by ${interaction.user}.`)
          .setColor('#FAA61A')
          .setTimestamp();

        await channel.send({
          embeds: [unclaimEmbed]
        });

        return;
      }

      if (interaction.customId === 'ticket_close') {
        const channel = interaction.channel;
        const { ownerId, type } = parseTicketTopic(channel.topic);

        if (!ownerId || !type) {
          return interaction.reply({
            content: 'This is not a valid ticket.',
            ephemeral: true
          });
        }

        if (!canCloseTicket(interaction.member, interaction.user.id, ownerId, type)) {
          return interaction.reply({
            content: 'Only the ticket owner or related staff can close this ticket.',
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('🔒 Ticket Closing')
          .setDescription('This ticket will be deleted in 5 seconds.')
          .setColor('#ED4245')
          .setTimestamp();

        await interaction.reply({
          content: 'Closing ticket...',
          ephemeral: true
        });

        await channel.send({ embeds: [embed] });

        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (err) {
            console.error('Channel delete error:', err);
          }
        }, 5000);

        return;
      }

      return;
    }

    // ===== SLASH COMMANDS =====
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'underreview') {
      if (!isHrStaff(interaction.member)) {
        return interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🟡 UNDER REVIEW')
        .setDescription(
`Hello,

Thank you for creating a ticket.

Your ticket has been received.

You will receive a response as soon as possible.
Please wait up to 48 hours before tagging anyone.

Orvion Convoy Control
HR Department

Kind regards`
        )
        .setColor('#FEE75C');

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'rejected') {
      if (!isHrStaff(interaction.member)) {
        return interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔴 REJECTED')
        .setDescription(
`Hello,

Thank you for creating the ticket and for the answers you provided.
We have reviewed your ticket and made our decision.

Unfortunately, your answers were not suitable for us.
We hope to see you again in the future.

Orvion Convoy Control
HR Department

Kind regards`
        )
        .setColor('#ED4245');

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'accepted') {
      if (!isHrStaff(interaction.member)) {
        return interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🟢 ACCEPTED')
        .setDescription(
`Hello,

Thank you for creating the ticket and for the answers you provided.
We have reviewed your ticket and made our decision.

After reviewing your answers, we have decided to approve your request.

Orvion Convoy Control
HR Department

Kind regards`
        )
        .setColor('#57F287');

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'sendpanel') {
      if (
        !isHrStaff(interaction.member) &&
        !isEventStaff(interaction.member) &&
        !isManagementStaff(interaction.member)
      ) {
        return interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true
        });
      }

      const channel = await client.channels.fetch(PANEL_CHANNEL_ID);

      if (!channel) {
        return interaction.reply({
          content: 'Panel channel not found.',
          ephemeral: true
        });
      }

      await channel.send({
        embeds: [buildPanelEmbed()],
        components: [buildPanelRow1(), buildPanelRow2()]
      });

      return interaction.reply({
        content: 'Panel message sent successfully.',
        ephemeral: true
      });
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);
  } catch (error) {
    console.error('Interaction error:', error);

    const errorMessage = 'There was an error while executing this command.';

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage }).catch(() => null);
      } else {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true
        }).catch(() => null);
      }
    }
  }
});

client.login(process.env.TOKEN);