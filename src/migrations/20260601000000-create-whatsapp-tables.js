export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({ schema: currentSchema, tableName: 'whatsapp_config' }, {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      ativo: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      lembrete_24h: {
        type: Sequelize.INTEGER,
        defaultValue: 1
      },
      lembrete_2h: {
        type: Sequelize.INTEGER,
        defaultValue: 1
      },
      lembrete_1h: {
        type: Sequelize.INTEGER,
        defaultValue: 1
      },
      modelo_mensagem: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      atualizado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.createTable({ schema: currentSchema, tableName: 'whatsapp_lembretes' }, {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      agendamento_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      tipo_lembrete: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      data_programada: {
        type: Sequelize.DATE,
        allowNull: false
      },
      data_envio: {
        type: Sequelize.DATE,
        allowNull: true
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      mensagem: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      erro: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      tentativas: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      criado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      atualizado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex({schema: currentSchema, tableName: 'whatsapp_lembretes'}, ['agendamento_id', 'tipo_lembrete'], {
      unique: true,
      name: 'idx_whatsapp_lembrete_unico'
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('whatsapp_config');
    await queryInterface.dropTable('whatsapp_lembretes');
  }
};
