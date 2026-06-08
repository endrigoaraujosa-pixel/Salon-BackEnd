const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface, Sequelize) {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash('admin', salt);

    await queryInterface.bulkInsert({ schema: 'company_salon', tableName: 'users' }, [{
      id: uuidv4(),
      email: 'admin@salon.com',
      password_hash: password_hash,
      name: 'Administrador',
      role: 'admin',
      ativo: true,
      pode_alterar_concluido: true,
      pode_excluir_agendamento: true,
      pode_excluir_pagamento: true,
      created_at: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete({ schema: 'company_salon', tableName: 'users' }, { email: 'admin@salon.com' }, {});
  }
};
