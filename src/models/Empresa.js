import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Empresa = sequelize.define('Empresa', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  razao_social: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  nome_fantasia: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  cnpj: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  inscricao_estadual: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  email: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  telefone: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  endereco_cep: {
    type: DataTypes.STRING(20),
    defaultValue: ''
  },
  endereco_logradouro: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  endereco_numero: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  endereco_bairro: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  endereco_cidade: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  endereco_uf: {
    type: DataTypes.STRING(10),
    defaultValue: ''
  }
}, {
  tableName: 'empresa'
});

export default Empresa;
