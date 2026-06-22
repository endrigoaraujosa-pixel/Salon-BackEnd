export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // 1. Add column to configuracao_sistema
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'configuracao_sistema' },
      'trabalhar_credito_cliente',
      {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      }
    );

    // 2. Add columns to clientes
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'clientes' },
      'saldo_credito',
      {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
      }
    );

    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'clientes' },
      'data_ultima_movimentacao_credito',
      {
        type: Sequelize.DATE,
        allowNull: true
      }
    );

    // 3. Add column to pagamentos
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'pagamentos' },
      'credito_gerado',
      {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
      }
    );

    // 4. Create table cliente_credito_movimentacoes
    await queryInterface.createTable(
      { schema: currentSchema, tableName: 'cliente_credito_movimentacoes' },
      {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false
        },
        cliente_id: {
          type: Sequelize.STRING(36),
          allowNull: false,
          references: {
            model: { schema: currentSchema, tableName: 'clientes' },
            key: 'id'
          }
        },
        tipo: {
          type: Sequelize.STRING(50),
          allowNull: false
        },
        tipo_operacao: {
          type: Sequelize.STRING(1),
          allowNull: false
        },
        valor: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false
        },
        saldo_anterior: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false
        },
        saldo_posterior: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false
        },
        usuario_id: {
          type: Sequelize.STRING(36),
          allowNull: false,
          references: {
            model: { schema: currentSchema, tableName: 'users' },
            key: 'id'
          }
        },
        usuario_nome: {
          type: Sequelize.STRING(255),
          allowNull: false
        },
        origem: {
          type: Sequelize.STRING(100),
          allowNull: true
        },
        movimentacao_original_id: {
          type: Sequelize.STRING(36),
          allowNull: true,
          references: {
            model: { schema: currentSchema, tableName: 'cliente_credito_movimentacoes' },
            key: 'id'
          }
        },
        observacao: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        dispositivo: {
          type: Sequelize.STRING(255),
          allowNull: true
        },
        estornado: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
          allowNull: false
        },
        criado_em: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      }
    );

    // 5. Add indexes to the table
    await queryInterface.addIndex(
      { schema: currentSchema, tableName: 'cliente_credito_movimentacoes' },
      ['cliente_id'],
      {
        name: `idx_cred_mov_cliente_${currentSchema}`
      }
    );

    await queryInterface.addIndex(
      { schema: currentSchema, tableName: 'cliente_credito_movimentacoes' },
      ['criado_em'],
      {
        name: `idx_cred_mov_criado_em_${currentSchema}`
      }
    );
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    // Drop indexes first
    await queryInterface.removeIndex(
      { schema: currentSchema, tableName: 'cliente_credito_movimentacoes' },
      `idx_cred_mov_cliente_${currentSchema}`
    );
    await queryInterface.removeIndex(
      { schema: currentSchema, tableName: 'cliente_credito_movimentacoes' },
      `idx_cred_mov_criado_em_${currentSchema}`
    );

    // Drop table
    await queryInterface.dropTable({ schema: currentSchema, tableName: 'cliente_credito_movimentacoes' });

    // Remove columns
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'pagamentos' },
      'credito_gerado'
    );
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'clientes' },
      'data_ultima_movimentacao_credito'
    );
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'clientes' },
      'saldo_credito'
    );
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'configuracao_sistema' },
      'trabalhar_credito_cliente'
    );
  }
};
