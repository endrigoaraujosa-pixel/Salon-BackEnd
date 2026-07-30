export default
  {
    async up(queryInterface, Sequelize) {
      const schema_name = queryInterface.sequelize.options.schema;
      // 1. AgendamentoOnlineDisponibilidade
      await queryInterface.createTable('agendamento_online_disponibilidade', {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
        },
        dia_semana: {
          type: Sequelize.INTEGER, // 0 = Domingo, 1 = Segunda, etc.
          allowNull: false
        },
        hora_inicio: {
          type: Sequelize.STRING(5), // "08:00"
          allowNull: false
        },
        hora_fim: {
          type: Sequelize.STRING(5), // "18:00"
          allowNull: false
        },
        ativo: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        },
        atualizado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        }
      }, { schema: schema_name });

      // 2. AgendamentoOnlineAuth
      await queryInterface.createTable('agendamento_online_auth', {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
        },
        telefone: {
          type: Sequelize.STRING(50),
          allowNull: false
        },
        codigo_otp: {
          type: Sequelize.STRING(10),
          allowNull: false
        },
        expira_em: {
          type: Sequelize.DATE,
          allowNull: false
        },
        tentativas: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        validado: {
          type: Sequelize.BOOLEAN,
          defaultValue: false
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        },
        atualizado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        }
      }, { schema: schema_name });

      // 3. AgendamentoOnlineSolicitacao
      await queryInterface.createTable('agendamento_online_solicitacoes', {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
        },
        cliente_id: {
          type: Sequelize.STRING(36),
          allowNull: true
        },
        nome_cliente: {
          type: Sequelize.STRING(255),
          allowNull: false
        },
        telefone: {
          type: Sequelize.STRING(50),
          allowNull: false
        },
        data_hora_desejada: {
          type: Sequelize.DATE,
          allowNull: false
        },
        servicos: {
          type: Sequelize.JSON,
          allowNull: false
        },
        profissional_id: {
          type: Sequelize.STRING(36),
          allowNull: true
        },
        observacoes: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        status: {
          type: Sequelize.STRING(50), // pendente, aprovado, rejeitado
          defaultValue: 'pendente'
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        },
        atualizado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        }
      }, { schema: schema_name });

    },

    async down(queryInterface, Sequelize) {
      const schema_name = queryInterface.sequelize.options.schema;
      await queryInterface.dropTable({ tableName: 'agendamento_online_solicitacoes', schema: schema_name });
      await queryInterface.dropTable({ tableName: 'agendamento_online_auth', schema: schema_name });
      await queryInterface.dropTable({ tableName: 'agendamento_online_disponibilidade', schema: schema_name });

    }
  }

