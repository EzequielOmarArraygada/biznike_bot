require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const cron = require('node-cron');
const { buscarBeneficios, obtenerZonasUnicas } = require('./buscador');
const { actualizarBeneficios } = require('./scraper');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const command = new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Despliega el panel interactivo de beneficios de PDB');

async function registrarComandos() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Registrando comando /panel en Discord...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [command.toJSON()] }
        );
        console.log('✅ Comando registrado correctamente.');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
}

client.once('clientReady', async () => {
    console.log(`🤖 Bot conectado como ${client.user.tag}`);
    await registrarComandos();

    cron.schedule('0 3 * * *', async () => {
        console.log('⏰ Ejecutando tarea programada: Actualizando beneficios...');
        await actualizarBeneficios();
    });
});

// Guardado temporal de búsquedas activas
const busquedasCache = new Map();

/**
 * Genera la vista en formato Grilla 3x3 (hasta 9 items por página)
 */
function generarPaginaGrilla(resultados, pagina, tituloBusqueda) {
    const porPagina = 9;
    const totalPaginas = Math.ceil(resultados.length / porPagina);
    const inicio = pagina * porPagina;
    const itemsPagina = resultados.slice(inicio, inicio + porPagina);

    // 1. Crear Embed en formato Grilla 3x3 (inline: true)
    const embedGrilla = new EmbedBuilder()
        .setTitle(`🔎 Buscando: ${tituloBusqueda}`)
        .setDescription(`Se encontraron **${resultados.length}** beneficios. Elige uno abajo para ver la tarjeta completa con logo y código.\n\u200b`)
        .setColor('#0099ff')
        .setFooter({ text: `Página ${pagina + 1} de ${totalPaginas} • PDB Beneficios` });

    itemsPagina.forEach((b, index) => {
        const num = inicio + index + 1;
        const tituloCorto = b.titulo.length > 22 ? b.titulo.substring(0, 20) + '...' : b.titulo;
        const descCorto = b.descripcion ? (b.descripcion.length > 40 ? b.descripcion.substring(0, 37) + '...' : b.descripcion) : 'Sin desc.';
        const zonaTag = b.zona ? `📍 \`${b.zona}\`\n` : '';

        embedGrilla.addFields({
            name: `${num}. ${tituloCorto}`,
            value: `${zonaTag}${descCorto}`,
            inline: true // Esto activa el comportamiento de 3 columnas en PC
        });
    });

    // 2. Crear Selector de Detalle para los 9 items de ESTA página
    const selectDetalle = new StringSelectMenuBuilder()
        .setCustomId('select_detalle_item')
        .setPlaceholder('ℹ️ Ver tarjeta completa con logo/links de...');

    const opciones = itemsPagina.map((b, index) => {
        const num = inicio + index + 1;
        return {
            label: `${num}. ${b.titulo}`.slice(0, 100),
            description: (b.descripcion || 'Ver detalle').slice(0, 100),
            value: b.titulo.slice(0, 100)
        };
    });

    selectDetalle.addOptions(opciones);
    const rowSelect = new ActionRowBuilder().addComponents(selectDetalle);

    // 3. Botones de Navegación de Página
    const btnAnterior = new ButtonBuilder()
        .setCustomId(`grilla_prev_${pagina}`)
        .setLabel('◀ Anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pagina === 0);

    const btnContador = new ButtonBuilder()
        .setCustomId('grilla_counter')
        .setLabel(`${pagina + 1} / ${totalPaginas}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);

    const btnSiguiente = new ButtonBuilder()
        .setCustomId(`grilla_next_${pagina}`)
        .setLabel('Siguiente ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pagina === totalPaginas - 1);

    const rowBotones = new ActionRowBuilder().addComponents(btnAnterior, btnContador, btnSiguiente);

    return {
        embeds: [embedGrilla],
        components: [rowSelect, rowBotones]
    };
}

/**
 * Muestra la tarjeta con imagen y links completa de un solo local
 */
async function responderDetalleUnico(interaction, tituloLocal) {
    const todos = buscarBeneficios();
    const b = todos.find(item => item.titulo === tituloLocal);

    if (!b) {
        return interaction.reply({
            content: '❌ No se encontró el beneficio seleccionado.',
            ephemeral: true
        });
    }

    const embedDetalle = new EmbedBuilder()
        .setTitle(b.titulo)
        .setDescription(b.descripcion || 'Sin descripción disponible')
        .setColor('#2b2d31');

    if (b.zona) {
        embedDetalle.addFields({ name: '📍 Ubicación / Zona', value: `\`${b.zona}\``, inline: true });
    }

    if (b.codigoDescuento) {
        embedDetalle.addFields({ name: '🔑 Código', value: `\`${b.codigoDescuento}\``, inline: true });
    }

    if (b.enlaces && b.enlaces.length > 0) {
        const linksFormatted = b.enlaces.map(link => {
            if (link.includes('instagram.com')) return `[Instagram](${link})`;
            if (link.includes('wa.me') || link.startsWith('tel:')) return `[Contacto](${link})`;
            if (link.startsWith('mailto:')) return `[Email](${link})`;
            return `[Sitio Web](${link})`;
        }).join(' | ');

        embedDetalle.addFields({ name: '🌐 Enlaces', value: linksFormatted, inline: false });
    }

    if (b.imagenUrl) {
        embedDetalle.setThumbnail(b.imagenUrl);
    }

    await interaction.reply({
        embeds: [embedDetalle],
        ephemeral: true
    });
}

// Interacción Principal
client.on('interactionCreate', async interaction => {
    try {
        // 1. Comando /panel
        if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
            const zonas = obtenerZonasUnicas();

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_zona')
                .setPlaceholder('📍 Selecciona una zona geográfica...');

            const opcionesZonas = zonas.slice(0, 25).map(z => ({
                label: z,
                value: z,
                emoji: '📍'
            }));

            if (opcionesZonas.length > 0) {
                selectMenu.addOptions(opcionesZonas);
            } else {
                selectMenu.addOptions([{ label: 'Sin zonas disponibles', value: 'ninguna' }]);
            }

            const rowSelect = new ActionRowBuilder().addComponents(selectMenu);

            const btnBuscar = new ButtonBuilder()
                .setCustomId('btn_buscar_texto')
                .setLabel('🔍 Buscar por Local o Palabra Clave')
                .setStyle(ButtonStyle.Primary);

            const rowButton = new ActionRowBuilder().addComponents(btnBuscar);

            const embedPanel = new EmbedBuilder()
                .setTitle('🎁 Buscador de Beneficios PDB')
                .setDescription(
                    'Bienvenido al sistema de consulta para suscriptores de **País de Boludos**.\n\n' +
                    '• **Por Zona:** Elige tu región en el desplegable.\n' +
                    '• **Por Texto:** Toca el botón para escribir un rubro o marca.'
                )
                .setColor('#0099ff')
                .setFooter({ text: 'Consultas privadas • PDB' });

            await interaction.reply({
                embeds: [embedPanel],
                components: [rowSelect, rowButton]
            });
        }

        // 2. Selección de Zona -> Carga Grilla
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_zona') {
            const zonaSeleccionada = interaction.values[0];
            const resultados = buscarBeneficios(zonaSeleccionada);
            
            if (resultados.length === 0) {
                return interaction.reply({ content: '❌ No hay resultados en esta zona.', ephemeral: true });
            }

            busquedasCache.set(`${interaction.user.id}_grilla`, { resultados, titulo: `Zona ${zonaSeleccionada}` });
            const payload = generarPaginaGrilla(resultados, 0, `Zona ${zonaSeleccionada}`);
            await interaction.reply({ ...payload, ephemeral: true });
        }

        // 3. Selección de un Item de la Grilla -> Muestra Tarjeta Individual
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_detalle_item') {
            const tituloLocal = interaction.values[0];
            await responderDetalleUnico(interaction, tituloLocal);
        }

        // 4. Modal de Búsqueda
        if (interaction.isButton() && interaction.customId === 'btn_buscar_texto') {
            const modal = new ModalBuilder()
                .setCustomId('modal_busqueda')
                .setTitle('Buscar Beneficios');

            const inputQuery = new TextInputBuilder()
                .setCustomId('input_texto')
                .setLabel('¿Qué local o producto buscas?')
                .setPlaceholder('Ej: Cannis, remeras, café, mendoza...')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(inputQuery));
            await interaction.showModal(modal);
        }

        // 5. Recepción de Texto del Modal -> Carga Grilla
        if (interaction.isModalSubmit() && interaction.customId === 'modal_busqueda') {
            const textoIngresado = interaction.fields.getTextInputValue('input_texto');
            const resultados = buscarBeneficios(textoIngresado);

            if (resultados.length === 0) {
                return interaction.reply({ content: `❌ No se encontraron resultados para "${textoIngresado}".`, ephemeral: true });
            }

            busquedasCache.set(`${interaction.user.id}_grilla`, { resultados, titulo: `"${textoIngresado}"` });
            const payload = generarPaginaGrilla(resultados, 0, `"${textoIngresado}"`);
            await interaction.reply({ ...payload, ephemeral: true });
        }

        // 6. Botones de Paginación de Grilla
        if (interaction.isButton() && (interaction.customId.startsWith('grilla_prev_') || interaction.customId.startsWith('grilla_next_'))) {
            const cacheData = busquedasCache.get(`${interaction.user.id}_grilla`);

            if (!cacheData) {
                return interaction.reply({ content: '⚠️ Tu sesión expiró. Busca de nuevo en el panel.', ephemeral: true });
            }

            const esSiguiente = interaction.customId.startsWith('grilla_next_');
            const paginaActual = parseInt(interaction.customId.split('_')[2], 10);
            const nuevaPagina = esSiguiente ? paginaActual + 1 : paginaActual - 1;

            const payload = generarPaginaGrilla(cacheData.resultados, nuevaPagina, cacheData.titulo);
            await interaction.update(payload);
        }

    } catch (error) {
        console.error('❌ Error en interacción:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);