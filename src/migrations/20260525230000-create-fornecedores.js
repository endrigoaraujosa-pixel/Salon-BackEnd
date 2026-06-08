export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({ schema: currentSchema, tableName: 'fornecedores' }, {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false
        },
        nome_razosocial: {
          type: Sequelize.STRING(255),
          allowNull: false
        },
        cpf_cnpj: {
          type: Sequelize.STRING(50),
          defaultValue: ''
        },
        telefone: {
          type: Sequelize.STRING(50),
          defaultValue: ''
        },
        email: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        endereco: {
          type: Sequelize.TEXT,
          defaultValue: ''
        },
        observacoes: {
          type: Sequelize.TEXT,
          defaultValue: ''
        },
        criado_em: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        deletado: {
          type: Sequelize.STRING(1),
          defaultValue: 'N',
          allowNull: false
        },
        deletado_por: {
          type: Sequelize.STRING(255),
          allowNull: true
        },
        deletado_em: {
          type: Sequelize.DATE,
          allowNull: true
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
      });  
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('fornecedores');
  }
};
