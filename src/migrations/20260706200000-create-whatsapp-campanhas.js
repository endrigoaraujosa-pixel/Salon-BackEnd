export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // Tabela de campanhas de mensagem em massa
    await queryInterface.createTable({ schema: currentSchema, tableName: 'whatsapp_campanhas' }, {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      titulo: {
        type: Sequelize.STRING(255),
        allowNull: false,
        defaultValue: 'Mensagem em Massa'
      },
      mensagem: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'agendada'
      },
      agendado_para: {
        type: Sequelize.DATE,
        allowNull: true
      },
      enviado_em: {
        type: Sequelize.DATE,
        allowNull: true
      },
      total_clientes: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      enviados: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      falhas: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      criado_por: {
        type: Sequelize.STRING(255),
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

    // Índice para buscar campanhas agendadas pendentes
    await queryInterface.addIndex(
      { schema: currentSchema, tableName: 'whatsapp_campanhas' },
      ['status', 'agendado_para'],
      { name: 'idx_campanhas_status_agendado' }
    );

    // Tabela de envios individuais por campanha
    await queryInterface.createTable({ schema: currentSchema, tableName: 'whatsapp_campanhas_envios' }, {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      campanha_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      cliente_id: {
        type: Sequelize.STRING(36),
        allowNull: true
      },
      cliente_nome: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      telefone: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      mensagem_enviada: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'pendente'
      },
      erro: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      enviado_em: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex(
      { schema: currentSchema, tableName: 'whatsapp_campanhas_envios' },
      ['campanha_id', 'status'],
      { name: 'idx_campanhas_envios_campanha_status' }
    );
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'whatsapp_campanhas_envios' });
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'whatsapp_campanhas' });
  }
};
