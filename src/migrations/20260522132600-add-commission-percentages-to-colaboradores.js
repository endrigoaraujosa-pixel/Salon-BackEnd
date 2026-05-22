export default {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('colaboradores');

    if (!tableDesc.comissao_sozinho) {
      await queryInterface.addColumn('colaboradores', 'comissao_sozinho', {
        type: Sequelize.FLOAT,
        defaultValue: 40,
        allowNull: true
      });
      // Copy existing comissao_principal to comissao_sozinho
      await queryInterface.sequelize.query(
        'UPDATE colaboradores SET comissao_sozinho = comissao_principal'
      );
    }

    if (!tableDesc.comissao_ajuda) {
      await queryInterface.addColumn('colaboradores', 'comissao_ajuda', {
        type: Sequelize.FLOAT,
        defaultValue: 30,
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('colaboradores', 'comissao_sozinho');
    await queryInterface.removeColumn('colaboradores', 'comissao_ajuda');
  }
};
