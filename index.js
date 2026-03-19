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
    .setDescription('Send accepted message')
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
  return username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 20);
}

function getTicketOwnerId(topic) {
  if (!topic) return null;
  const match = topic.match(/owner:(\d+)/);
  return match ? match[1] : null;
}

// ===== READY =====
client.once('clientReady', async () => {
  try {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    if (!channel) {
      console.log('Panel channel not found!');
      return;
    }

    const messages = await channel.messages.fetch({ limit: 100 });

    const panelMessages = messages
      .filter(msg =>
        msg.author.id === client.user.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title === '📩 Apply Now'
      )
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    if (panelMessages.size > 0) {
      const panelArray = [...panelMessages.values()];

      if (panelArray.length > 1) {
        for (let i = 1; i < panelArray.length; i++) {
          try {
            await panelArray[i].delete();
          } catch (err) {
            console.error('Duplicate panel delete error:', err);
          }
        }
      }

      console.log('Panel already exists, skipping...');
      console.log(`Logged in as ${client.user.tag}`);
      return;
    }

    const embed = new EmbedBuilder()
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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('Open Ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary)
    );

    await channel.send({
      embeds: [embed],
      components: [row]
    });

    console.log('Panel message sent!');
    console.log(`Logged in as ${client.user.tag}`);
  } catch (error) {
    console.error('Panel send error:', error);
  }
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  try {
    // ===== SLASH COMMANDS =====
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'underreview') {
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

      return;
    }

    // ===== BUTTONS =====
    if (!interaction.isButton()) return;

    // OPEN TICKET
    if (interaction.customId === 'ticket_open') {
      const guild = interaction.guild;
      const member = interaction.member;

      const existing = guild.channels.cache.find(c => {
        if (c.type !== ChannelType.GuildText) return false;
        const ownerId = getTicketOwnerId(c.topic);
        return ownerId === member.id;
      });

      if (existing) {
        return interaction.reply({
          content: `You already have an open ticket: ${existing}`,
          ephemeral: true
        });
      }

      const channelName = `ticket-${sanitizeChannelName(interaction.user.username)}`;

      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `owner:${member.id}`,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: member.id,
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
        .setColor('#57F287');

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('Claim')
          .setEmoji('🛄')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Close')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${member} <@&${HRM_ROLE_ID}> <@&${HRT_ROLE_ID}>`,
        embeds: [ticketEmbed],
        components: [buttons]
      });

      return interaction.reply({
        content: `Your ticket has been created: ${ticketChannel}`,
        ephemeral: true
      });
    }

    // CLAIM DISABLED
    if (interaction.customId === 'ticket_claim') {
      return interaction.reply({
        content: 'Claim system is currently disabled.',
        ephemeral: true
      });
    }

    // CLOSE TICKET
    if (interaction.customId === 'ticket_close') {
      const channel = interaction.channel;
      const ownerId = getTicketOwnerId(channel.topic);

      if (!ownerId) {
        return interaction.reply({
          content: 'This is not a valid ticket.',
          ephemeral: true
        });
      }

      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: 'Only the ticket owner can close this ticket.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 Ticket Closing')
        .setDescription('This ticket will be deleted in 5 seconds.')
        .setColor('#ED4245');

      await interaction.reply({
        content: 'Closing ticket...',
        ephemeral: true
      });

      await channel.send({
        embeds: [embed]
      });

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