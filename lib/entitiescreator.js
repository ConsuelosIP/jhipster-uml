'use strict';

const chalk = require('chalk'),
    fs = require('fs'),
    _ = require('lodash'),
    merge = require('./utils/object_utils').merge,
    areJHipsterEntitiesEqual = require('./helpers/object_helper').areJHipsterEntitiesEqual,
    isNoSQL = require('./types/types_helper').isNoSQL,
    checkValidityOfAssociation = require('./helpers/association_helper').checkValidityOfAssociation,
    cardinalities = require('./cardinalities'),
    formatComment = require('./helpers/comment_helper').formatComment,
    buildException = require('./exceptions/exception_factory').buildException,
    exceptions = require('./exceptions/exception_factory').exceptions;

const USER = 'user';

var entitiesToSuppress;
var listDTO;
var listPagination;
var listService;
var microserviceNames;
var entities;
var onDiskEntities;
var searchEngines;
var databaseTypes;
var parsedData;

module.exports = {
  createEntities: createEntities
};

/**
 * Keys of args:
 *   - parsedData,
 *   - databaseTypes,
 *   - listDTO,
 *   - listPagination,
 *   - listService,
 *   - microserviceNames,
 *   - searchEngines.
 */
function createEntities(args) {
  var merged = merge(defaults(), args);
  if (!merged.parsedData || !merged.databaseTypes) {
    throw new buildException(
        exceptions.NullPointer,
        'The parsed data and database types are mandatory.');
  }
  init(merged);
  checkNoSQLModeling();
  readJSONFiles();
  initializeEntities();
  fillEntities();
  return entities;
}

function init(args) {
  entitiesToSuppress = [];
  listDTO = args.listDTO;
  listPagination = args.listPagination;
  listService = args.listService;
  microserviceNames = args.microserviceNames;
  searchEngines = args.searchEngines;
  databaseTypes = args.databaseTypes;
  parsedData = args.parsedData;
  entities = {};
  onDiskEntities = {};
}

function checkNoSQLModeling() {
  if (isNoSQL(databaseTypes) && Object.keys(parsedData.associations).length !== 0) {
    throw new buildException(
        exceptions.NoSQLModeling, "NoSQL entities don't have relationships.");
  }
}

function readJSONFiles() {
  for (let classId in parsedData.classes) {
    if (parsedData.classes.hasOwnProperty(classId)) {
      let file = '.jhipster/' + parsedData.getClass(classId).name + '.json';
      if (fs.existsSync(file)) {
        onDiskEntities[classId] = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    }
  }
}

function initializeEntities() {
  var index = 0;
  for (let classId in parsedData.classes) {
    if (parsedData.classes.hasOwnProperty(classId)) {
      let initializedEntity = {
        relationships: [],
        fields: [],
        changelogDate: getChangelogDate(classId, index),
        dto: parsedData.getClass(classId).dto,
        pagination: parsedData.getClass(classId).pagination,
        service: parsedData.getClass(classId).service,
        microserviceName: parsedData.getClass(classId).microserviceName,
        searchEngine: parsedData.getClass(classId).searchEngine,
        javadoc: formatComment(parsedData.getClass(classId).comment),
        entityTableName: _.snakeCase(parsedData.getClass(classId).tableName)
      };

      initializedEntity =
          setOptions(initializedEntity, parsedData.getClass(classId).name);

      entities[classId] = initializedEntity;
      index++;
    }
  }
}

function getChangelogDate(classId, increment) {
  if (onDiskEntities[classId]) {
    return onDiskEntities[classId].changelogDate;
  }
  return dateFormatForLiquibase(increment);
}

function dateFormatForLiquibase(increment) {
  var now = new Date();
  var now_utc = new Date(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds());
  var year = '' + now_utc.getFullYear();
  var month = '' + (now_utc.getMonth() + 1);
  if (month.length === 1) {
    month = `0${month}`;
  }
  var day = '' + now_utc.getDate();
  if (day.length === 1) {
    day = `0${day}`;
  }
  var hour = '' + now_utc.getHours();
  if (hour.length === 1) {
    hour = `0${hour}`;
  }
  var minute = '' + now_utc.getMinutes();
  if (minute.length === 1) {
    minute = `0{minute}`;
  }
  var second = '' + (now_utc.getSeconds() + increment) % 60;
  if (second.length === 1) {
    second = `0${second}`;
  }
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function setOptions(entity, entityName) {
  if (listDTO.indexOf(entityName) !== -1) {
    entity.dto = 'mapstruct';
  }
  if (listPagination.hasOwnProperty(entityName)) {
    entity.pagination = listPagination[entityName];
  }
  if (listService.hasOwnProperty(entityName)) {
    entity.service = listService[entityName];
  }
  if (microserviceNames.hasOwnProperty(entityName)) {
    entity.microserviceName = microserviceNames[entityName];
  }
  if (searchEngines.indexOf(entityName) !== -1) {
    entity.searchEngine = 'elasticsearch';
  }
  return entity;
}

function defaults() {
  return {
    listDTO: [],
    listPagination: {},
    listService: {},
    microserviceNames: {},
    searchEngines: []
  };
}

function fillEntities() {
  Object.keys(parsedData.classes).forEach(function (classId) {

    /*
     * If the user adds a 'User' entity we consider it as the already
     * created JHipster User entity and none of its fields and ownerside
     * relationships will be considered.
     */
    if (parsedData.getClass(classId).name.toLowerCase() === USER) {
      console.warn(
          chalk.yellow(
              "Warning:  An Entity called 'User' was defined: 'User' is an" +
              ' entity created by default by JHipster. All relationships toward' +
              ' it will be kept but all attributes and relationships from it' +
              ' will be disregarded.'));
      entitiesToSuppress.push(classId);
    }
    setFieldsOfEntity(classId);
    setRelationshipOfEntity(classId);
  });

  entitiesToSuppress.forEach(function (entity) {
    delete entities[entity];
  });
}

function setFieldsOfEntity(classId) {
  parsedData.classes[classId].fields.forEach(function (fieldId) {
    var fieldData = {
      fieldId: entities[classId].fields.length + 1,
      fieldName: _.camelCase(parsedData.getField(fieldId).name),
      javadoc: formatComment(parsedData.getField(fieldId).comment)
    };

    if (parsedData.types[parsedData.getField(fieldId).type]) {
      fieldData.fieldType = parsedData.getType(parsedData.getField(fieldId).type).name;
    } else if (parsedData.getEnum(parsedData.getField(fieldId).type)) {
      fieldData.fieldType = parsedData.getEnum(parsedData.getField(fieldId).type).name;
      fieldData.fieldValues = parsedData.getEnum(parsedData.getField(fieldId).type).values.join(',');
    }

    if (fieldData.fieldType === 'ImageBlob') {
      fieldData.fieldType = 'byte[]';
      fieldData.fieldTypeBlobContent = 'image';
    } else if (fieldData.fieldType === 'Blob' || fieldData.fieldType === 'AnyBlob') {
      fieldData.fieldType = 'byte[]';
      fieldData.fieldTypeBlobContent = 'any';
    }

    setValidationsOfField(fieldData, fieldId);
    entities[classId].fields.push(fieldData);
  });
}

function setValidationsOfField(field, fieldId) {
  if (parsedData.getField(fieldId).validations.length === 0) {
    return;
  }
  field.fieldValidateRules = [];

  parsedData.getField(fieldId).validations.forEach(function (validationId) {
    var validation = parsedData.getValidation(validationId);
    field.fieldValidateRules.push(validation.name);
    if (validation.name !== 'required') {
      field['fieldValidateRules' + _.capitalize(validation.name)] =
          validation.value;
    }
  });
}

function getRelatedAssociations(classId, associationIds, associations) {
  var relationships = {
    from: [],
    to: []
  };
  associationIds.forEach(function (associationId) {
    var association = associations[associationId];
    if (association.from === classId) {
      relationships.from.push(associationId);
    }
    if (association.to === classId && association.injectedFieldInTo) {
      relationships.to.push(associationId);
    }
  });
  return relationships;
}

/**
 * Parses the string "<relationshipName>(<otherEntityField>)"
 * @param{String} field
 * @return{Object} where 'relationshipName' is the relationship name and
 *                'otherEntityField' is the other entity field name
 */
function extractField(field) {
  var splitField = {
    otherEntityField: 'id', // id by default
    relationshipName: ''
  };
  if (field) {
    var chunks = field.replace('(', '/').replace(')', '').split('/');
    splitField.relationshipName = chunks[0];
    if (chunks.length > 1) {
      splitField.otherEntityField = chunks[1];
    }
  }
  return splitField;
}

function setRelationshipOfEntity(classId) {
  var associations = getRelatedAssociations(
      classId,
      Object.keys(parsedData.associations),
      parsedData.associations);
  associations.from.forEach(function (associationId) {
    var otherSplitField;
    var splitField;
    var association = parsedData.getAssociation(associationId);
    checkValidityOfAssociation(
        association,
        parsedData.getClass(association.from).name,
        parsedData.getClass(association.to).name);
    var relationship = {
      relationshipId: entities[classId].relationships.length + 1,
      relationshipType: association.type
    };
    if (association.type === cardinalities.ONE_TO_ONE) {
      splitField = extractField(association.injectedFieldInFrom);
      relationship.relationshipName = _.camelCase(splitField.relationshipName);
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.to).name));
      relationship.otherEntityField = _.lowerFirst(splitField.otherEntityField);
      relationship.ownerSide = true;
      relationship.otherEntityRelationshipName = _.lowerFirst(association.injectedFieldInTo || parsedData.getClass(association.from).name);
    } else if (association.type === cardinalities.ONE_TO_MANY) {
      splitField = extractField(association.injectedFieldInFrom);
      otherSplitField = extractField(association.injectedFieldInTo);
      relationship.relationshipName = _.lowerFirst(_.camelCase(splitField.relationshipName || parsedData.getClass(association.to).name));
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.to).name));
      relationship.otherEntityRelationshipName = _.lowerFirst(otherSplitField.relationshipName);
      if (!association.injectedFieldInTo) {
        relationship.otherEntityRelationshipName = _.lowerFirst(parsedData.getClass(association.from).name);
        otherSplitField = extractField(association.injectedFieldInTo);
        var otherSideRelationship = {
          relationshipId: entities[association.to].relationships.length + 1,
          relationshipName: _.camelCase(_.lowerFirst(parsedData.getClass(association.from).name)),
          otherEntityName: _.lowerFirst(_.camelCase(parsedData.getClass(association.from).name)),
          relationshipType: cardinalities.MANY_TO_ONE,
          otherEntityField: _.lowerFirst(otherSplitField.otherEntityField)
        };
        association.type = cardinalities.MANY_TO_ONE;
        entities[association.to].relationships.push(otherSideRelationship);
      }
    } else if (association.type === cardinalities.MANY_TO_ONE && association.injectedFieldInFrom) {
      splitField = extractField(association.injectedFieldInFrom);
      relationship.relationshipName = _.camelCase(splitField.relationshipName);
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.to).name));
      relationship.otherEntityField = _.lowerFirst(splitField.otherEntityField);
    } else if (association.type === cardinalities.MANY_TO_MANY) {
      splitField = extractField(association.injectedFieldInFrom);
      relationship.relationshipName = _.camelCase(splitField.relationshipName);
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.to).name));
      relationship.otherEntityField = _.lowerFirst(splitField.otherEntityField);
      relationship.ownerSide = true;
    }
    entities[classId].relationships.push(relationship);
  });
  associations.to.forEach(function (associationId) {
    var splitField;
    var otherSplitField;
    var association = parsedData.getAssociation(associationId);
    var relationship = {
      relationshipId: entities[classId].relationships.length + 1,
      relationshipType: (association.type === cardinalities.ONE_TO_MANY ? cardinalities.MANY_TO_ONE : association.type)
    };
    if (association.type === cardinalities.ONE_TO_ONE) {
      splitField = extractField(association.injectedFieldInTo);
      otherSplitField = extractField(association.injectedFieldInFrom);
      relationship.relationshipName = _.camelCase(splitField.relationshipName);
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.from).name));
      relationship.ownerSide = false;
      relationship.otherEntityRelationshipName = _.lowerFirst(otherSplitField.relationshipName);
    } else if (association.type === cardinalities.ONE_TO_MANY) {
      association.injectedFieldInTo = association.injectedFieldInTo || _.lowerFirst(association.from);
      splitField = extractField(association.injectedFieldInTo);
      relationship.relationshipName = _.lowerFirst(_.camelCase(splitField.relationshipName || parsedData.getClass(association.from).name));
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.from).name));
      relationship.otherEntityField = _.lowerFirst(splitField.otherEntityField);
    } else if (association.type === cardinalities.MANY_TO_ONE && association.injectedFieldInTo) {
      splitField = extractField(association.injectedFieldInTo);
      relationship.relationshipName = _.camelCase(splitField.relationshipName);
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.from).name));
      relationship.otherEntityField = _.lowerFirst(splitField.otherEntityField);
    } else if (association.type === cardinalities.MANY_TO_MANY) {
      splitField = extractField(association.injectedFieldInTo);
      relationship.relationshipName = _.camelCase(splitField.relationshipName);
      relationship.otherEntityName = _.lowerFirst(_.camelCase(parsedData.getClass(association.from).name));
      relationship.ownerSide = false;
      relationship.otherEntityRelationshipName = _.lowerFirst(extractField(association.injectedFieldInFrom).relationshipName);
    }
    entities[classId].relationships.push(relationship);
  });
}

/**
 * Removes all unchanged entities.
 * @param {Array} entities all the entities to filter.
 * @returns {Array} the changed entities.
 */
function filterOutUnchangedEntities(entities) {
  var onDiskEntities = readJSON(entities);
  return entities.filter(function (id) {
    var currEntity = onDiskEntities[id];
    var newEntity = entities[id];
    if (!currEntity) {
      return true;
    }
    return !areJHipsterEntitiesEqual(currEntity, newEntity);
  });
}
