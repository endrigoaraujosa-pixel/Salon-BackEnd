export default {
  async up(queryInterface, Sequelize) {
    try {
      const [perfis] = await queryInterface.sequelize.query("SELECT id, permissoes FROM perfis_acesso;");
      for (const perfil of perfis) {
        let perms;
        try {
          perms = typeof perfil.permissoes === 'string' ? JSON.parse(perfil.permissoes) : perfil.permissoes;
        } catch (e) {
          perms = {};
        }

        if (perms && perms.acoes) {
          if (perms.acoes.realizar_pagamento === undefined) {
            perms.acoes.realizar_pagamento = true;
            await queryInterface.sequelize.query(
              "UPDATE perfis_acesso SET permissoes = :permissoes WHERE id = :id;",
              {
                replacements: {
                  permissoes: JSON.stringify(perms),
                  id: perfil.id
                }
              }
            );
          }
        }
      }
    } catch (err) {
      console.error("Migration error adding realizar_pagamento permission:", err);
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      const [perfis] = await queryInterface.sequelize.query("SELECT id, permissoes FROM perfis_acesso;");
      for (const perfil of perfis) {
        let perms;
        try {
          perms = typeof perfil.permissoes === 'string' ? JSON.parse(perfil.permissoes) : perfil.permissoes;
        } catch (e) {
          perms = {};
        }

        if (perms && perms.acoes && perms.acoes.realizar_pagamento !== undefined) {
          delete perms.acoes.realizar_pagamento;
          await queryInterface.sequelize.query(
            "UPDATE perfis_acesso SET permissoes = :permissoes WHERE id = :id;",
            {
              replacements: {
                permissoes: JSON.stringify(perms),
                id: perfil.id
              }
            }
          );
        }
      }
    } catch (err) {
      console.error("Migration rollback error for realizar_pagamento permission:", err);
    }
  }
};
