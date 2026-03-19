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
  Routes
} = require('discord.js');

console.log('HR + EVENT TICKET SYSTEM ACTIVE');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

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
const EVENT_TEAM_ROLE_ID = '1476659748257402982';

// Aynı anda 2 ticket açılmasını engeller
const pendingTicketOpens = new Set();

// ===== SLASH COMMANDS =====
const commands = [
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
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (error) {
    console.error('Slash command register error:', error);
  }
})();

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

function canClaimTicket(member, type) {
  if (type === 'hr') return isHrStaff(member);
  if (type === 'event') return isEventStaff(member);
  return false;
}

function canCloseTicket(member, userId, ownerId, type) {
  if (userId === ownerId) return true;
  if (type === 'hr') return isHrStaff(member);
  if (type === 'event') return isEventStaff(member);
  return false;
}

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📩 Apply / Contact')
    .setDescription(
`Please choose the ticket type below.

🎫 HR Ticket
Use this for applications and HR-related topics.

🎉 Event Ticket
Use this for event management and event-related topics.`
    )
    .setColor('#5865F2');
}

function buildPanelRow() {
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

    if (type === 'hr') {
      categoryId = HR_CATEGORY_ID;
      roleIds = [HRM_ROLE_ID, HRT_ROLE_ID];
      channelPrefix = 'hr-ticket';
      mentionText = `${member} <@&${HRM_ROLE_ID}> <@&${HRT_ROLE_ID}>`;
      embedTitle = '📩 HR Ticket Created';
      embedDescription = `${member}, please describe your HR issue or application in detail.`;
    } else {
      categoryId = EVENT_CATEGORY_ID;
      roleIds = [EVENT_MANAGER_ROLE_ID, EVENT_TEAM_ROLE_ID];
      channelPrefix = 'event-ticket';
      mentionText = `${member} <@&${EVENT_MANAGER_ROLE_ID}> <@&${EVENT_TEAM_ROLE_ID}>`;
      embedTitle = '🎉 Event Ticket Created';
      embedDescription = `${member}, please describe your event request in detail.`;
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
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ];

    for (const roleId of roleIds) {
      permissionOverwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
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
      .setColor(type === 'hr' ? '#57F287' : '#5865F2')
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

// ===== READY =====
client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  try {
    // ===== SLASH COMMANDS =====
    if (interaction.isChatInputCommand()) {
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
        if (!isHrStaff(interaction.member) && !isEventStaff(interaction.member)) {
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
          components: [buildPanelRow()]
        });

        return interaction.reply({
          content: 'Panel message sent successfully.',
          ephemeral: true
        });
      }

      return;
    }

    // ===== BUTTONS =====
    if (!interaction.isButton()) return;

    // OPEN HR TICKET
    if (interaction.customId === 'ticket_open_hr') {
      return createTicket(interaction, 'hr');
    }

    // OPEN EVENT TICKET
    if (interaction.customId === 'ticket_open_event') {
      return createTicket(interaction, 'event');
    }

    // CLAIM
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

    // CLOSE
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
  } catch (error) {
    console.error('Interaction error:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);