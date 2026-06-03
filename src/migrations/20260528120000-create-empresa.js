export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({ schema: currentSchema, tableName: 'empresa' }, {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false
        },
        razao_social: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        nome_fantasia: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        cnpj: {
          type: Sequelize.STRING(50),
          defaultValue: ''
        },
        inscricao_estadual: {
          type: Sequelize.STRING(50),
          defaultValue: ''
        },
        email: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        telefone: {
          type: Sequelize.STRING(50),
          defaultValue: ''
        },
        endereco_cep: {
          type: Sequelize.STRING(20),
          defaultValue: ''
        },
        endereco_logradouro: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        endereco_numero: {
          type: Sequelize.STRING(50),
          defaultValue: ''
        },
        endereco_bairro: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        endereco_cidade: {
          type: Sequelize.STRING(255),
          defaultValue: ''
        },
        endereco_uf: {
          type: Sequelize.STRING(10),
          defaultValue: ''
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
    await queryInterface.dropTable('empresa');
  }
};
