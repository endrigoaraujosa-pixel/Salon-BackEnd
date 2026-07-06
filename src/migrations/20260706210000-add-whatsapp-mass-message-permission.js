export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // Fetch existing profiles
    const perfis = await queryInterface.sequelize.query(
      `SELECT id, nome, permissoes FROM "${currentSchema}"."perfis_acesso";`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const p of perfis) {
      let perms = {};
      try {
        perms = typeof p.permissoes === 'string' ? JSON.parse(p.permissoes) : p.permissoes;
      } catch (e) {
        perms = {};
      }

      // If it is the admin profile or represents an admin
      const isAdmin = p.id === 'admin-profile-uuid-00000000000000000' || p.nome === 'Administrador' || perms.acoes?.is_admin === true;

      // Create new permission key and assign value
      perms["configuracoes.whatsapp_mensagem_massa"] = isAdmin;

      await queryInterface.sequelize.query(
        `UPDATE "${currentSchema}"."perfis_acesso" SET "permissoes" = :permissoes WHERE "id" = :id;`,
        {
          replacements: {
            permissoes: JSON.stringify(perms),
            id: p.id
          },
          type: queryInterface.sequelize.QueryTypes.UPDATE
        }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    const perfis = await queryInterface.sequelize.query(
      `SELECT id, nome, permissoes FROM "${currentSchema}"."perfis_acesso";`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const p of perfis) {
      let perms = {};
      try {
        perms = typeof p.permissoes === 'string' ? JSON.parse(p.permissoes) : p.permissoes;
      } catch (e) {
        perms = {};
      }

      if (perms && perms["configuracoes.whatsapp_mensagem_massa"] !== undefined) {
        delete perms["configuracoes.whatsapp_mensagem_massa"];

        await queryInterface.sequelize.query(
          `UPDATE "${currentSchema}"."perfis_acesso" SET "permissoes" = :permissoes WHERE "id" = :id;`,
          {
            replacements: {
              permissoes: JSON.stringify(perms),
              id: p.id
            },
            type: queryInterface.sequelize.QueryTypes.UPDATE
          }
        );
      }
    }
  }
};
