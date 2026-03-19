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

console.log('NEW CLAIM EMBED CODE ACTIVE');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== IDs =====
const CLIENT_ID = '1484192795777433680';
const GUILD_ID = '1475150576361803776';

const PANEL_CHANNEL_ID = '1483077963661574244';
const TICKET_CATEGORY_ID = '1475335652420620471';
const HRM_ROLE_ID = '1476659899961442407';
const HRT_ROLE_ID = '1476659748257402982';

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
  if (!topic) return { ownerId: null, claimedBy: null };

  const ownerMatch = topic.match(/owner:(\d+)/);
  const claimedMatch = topic.match(/claimed:(\d+)/);

  return {
    ownerId: ownerMatch ? ownerMatch[1] : null,
    claimedBy: claimedMatch ? claimedMatch[1] : null
  };
}

function buildTicketTopic(ownerId, claimedBy = null) {
  return claimedBy
    ? `owner:${ownerId}|claimed:${claimedBy}`
    : `owner:${ownerId}`;
}

function isStaff(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.has(HRM_ROLE_ID) || member.roles.cache.has(HRT_ROLE_ID);
}

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📩 Apply Now')
    .setDescription(
`Hello, do you want to join us?
Please read the rules first.

Thank you for reading the rules.

Below you can see the availability status of the roles within our team.
CC Member <@&1483082794254204998>
Media Team <@&1483082794254204998>
Media Manager <@&1483082794254204998>
HR Team <@&1483082794254204998>
HR Manager <@&1483082794254204998>
Event Team <@&1483082794254204998>
Event Manager <@&1483082794254204998>
Event Assistance <@&1483082794254204998>
Event Supervisior <@&1483082794254204998>
Community Manager <@&1483082890962145452>

Please do not hesitate to apply to us.`
    )
    .setColor('#5865F2');
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('Open Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary)
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
        if (!isStaff(interaction.member)) {
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
        if (!isStaff(interaction.member)) {
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
        if (!isStaff(interaction.member)) {
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
        if (!isStaff(interaction.member)) {
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

    // ===== OPEN TICKET =====
    if (interaction.customId === 'ticket_open') {
      const guild = interaction.guild;
      const member = interaction.member;
      const userId = member.id;

      if (pendingTicketOpens.has(userId)) {
        return interaction.reply({
          content: 'Your ticket is already being created. Please wait a moment.',
          ephemeral: true
        });
      }

      pendingTicketOpens.add(userId);

      try {
        await interaction.deferReply({ ephemeral: true });
        await guild.channels.fetch();

        const existing = guild.channels.cache.find(c => {
          if (c.type !== ChannelType.GuildText) return false;
          if (c.parentId !== TICKET_CATEGORY_ID) return false;

          const { ownerId } = parseTicketTopic(c.topic);
          return ownerId === userId;
        });

        if (existing) {
          return interaction.editReply({
            content: `You already have an open ticket: ${existing}`
          });
        }

        const channelName = `ticket-${sanitizeChannelName(interaction.user.username)}-${userId.slice(-4)}`;

        const ticketChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: TICKET_CATEGORY_ID,
          topic: buildTicketTopic(userId),
          permissionOverwrites: [
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
            },
            {
              id: HRM_ROLE_ID,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            },
            {
              id: HRT_ROLE_ID,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            }
          ]
        });

        const ticketEmbed = new EmbedBuilder()
          .setTitle('🎫 Ticket Created')
          .setDescription(`${member}, please describe your issue in detail.`)
          .setColor('#57F287')
          .setTimestamp();

        await ticketChannel.send({
          content: `${member} <@&${HRM_ROLE_ID}> <@&${HRT_ROLE_ID}>`,
          embeds: [ticketEmbed],
          components: [buildTicketButtons()]
        });

        return interaction.editReply({
          content: `Your ticket has been created: ${ticketChannel}`
        });
      } catch (error) {
        console.error('Ticket open error:', error);

        if (interaction.deferred) {
          return interaction.editReply({
            content: 'An error occurred while creating the ticket.'
          });
        }
      } finally {
        pendingTicketOpens.delete(userId);
      }

      return;
    }

    // ===== CLAIM =====
    if (interaction.customId === 'ticket_claim') {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: 'You do not have permission to claim tickets.',
          ephemeral: true
        });
      }

      const channel = interaction.channel;
      const { ownerId, claimedBy } = parseTicketTopic(channel.topic);

      if (!ownerId) {
        return interaction.reply({
          content: 'This is not a valid ticket.',
          ephemeral: true
        });
      }

      if (claimedBy) {
        return interaction.reply({
          content: `This ticket is already claimed by <@${claimedBy}>.`,
          ephemeral: true
        });
      }

      await channel.setTopic(buildTicketTopic(ownerId, interaction.user.id));

      await interaction.update({
        components: [buildTicketButtons(interaction.user.id, interaction.user.username)]
      });

      const claimEmbed = new EmbedBuilder()
        .setTitle('🛄 Ticket Claimed')
        .setDescription(`This ticket has been claimed by ${interaction.user}.`)
        .setColor('#5865F2')
        .setTimestamp();

      await channel.send({
        embeds: [claimEmbed]
      });

      return;
    }

    // ===== CLOSE =====
    if (interaction.customId === 'ticket_close') {
      const channel = interaction.channel;
      const { ownerId } = parseTicketTopic(channel.topic);

      if (!ownerId) {
        return interaction.reply({
          content: 'This is not a valid ticket.',
          ephemeral: true
        });
      }

      const ticketOwnerCanClose = interaction.user.id === ownerId;
      const staffCanClose = isStaff(interaction.member);

      if (!ticketOwnerCanClose && !staffCanClose) {
        return interaction.reply({
          content: 'Only the ticket owner or HR staff can close this ticket.',
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