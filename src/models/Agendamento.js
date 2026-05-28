import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Agendamento = sequelize.define('Agendamento', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  numero: {
    type: DataTypes.INTEGER,
    defaultValue: null
  },
  cliente_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  cliente_nome: {
    type: DataTypes.STRING(255)
  },
  data_hora: {
    type: DataTypes.DATE,
    allowNull: false
  },
  itens: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  profissionais: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  observacoes: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  valor_total: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  duracao_minutos: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'agendado'
  },
  valor_pago: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  alterado_por_id: {
    type: DataTypes.STRING(36),
    defaultValue: null
  },
  alterado_em: {
    type: DataTypes.DATE,
    defaultValue: null
  },
  criado_por_id: {
    type: DataTypes.STRING(36),
    defaultValue: null
  },
  criado_por_nome: {
    type: DataTypes.STRING(255),
    defaultValue: null
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  deletado: {
    type: DataTypes.STRING(1),
    defaultValue: 'N',
    allowNull: false
  },
  deletado_por: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  deletado_em: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'agendamentos'
});

export default Agendamento;
