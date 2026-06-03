export default {
  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn('taxas_cartao', 'dias_recebimento', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 0
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('taxas_cartao', 'dias_recebimento');
  }
};
