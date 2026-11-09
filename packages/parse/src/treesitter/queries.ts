import type { LanguageId } from '../languages.js';

/*
 * Tags queries per language (Aider-style definitions and references), written for the grammar
 * versions in tree-sitter-wasms 0.1.x. Capture convention, read by tags.ts:
 *   @def.<symbolKind>  the whole definition node; the same match carries @name (the identifier).
 *   @ref.<refKind>     an identifier that references something: call | type | inherit | new.
 *   @import            an import specifier node (string literal, dotted name, include path).
 * Kinds use the kernel SymbolKind vocabulary; tags.ts upgrades function → method inside classes.
 */

const TS_COMMON = `
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (_) @name) @def.class
(method_definition name: (property_identifier) @name) @def.method
(lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @def.function
(variable_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @def.function
(program (lexical_declaration (variable_declarator name: (identifier) @name value: [(object) (array) (string) (number) (call_expression) (new_expression) (template_string)])) @def.constant)
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @name value: [(object) (array) (string) (number) (call_expression) (new_expression) (template_string)])) @def.constant))
(expression_statement (call_expression function: (identifier) @_fn arguments: (arguments . [(string) (template_string)] @name)) (#match? @_fn "^(describe|it|test)$")) @def.test

(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.new)
(new_expression constructor: (member_expression property: (property_identifier) @ref.new))
(import_statement source: (string) @import)
(export_statement source: (string) @import)
(call_expression function: (identifier) @_req arguments: (arguments . (string) @import) (#eq? @_req "require"))
(call_expression function: (import) arguments: (arguments . (string) @import))
`;

const TS_TYPES = `
(abstract_class_declaration name: (type_identifier) @name) @def.class
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(method_signature name: (property_identifier) @name) @def.method
(abstract_method_signature name: (property_identifier) @name) @def.method
(public_field_definition name: (property_identifier) @name) @def.property
(property_signature name: (property_identifier) @name) @def.property

(class_heritage (extends_clause value: (identifier) @ref.inherit))
(type_annotation (type_identifier) @ref.type)
(type_arguments (type_identifier) @ref.type)
(class_heritage (implements_clause (type_identifier) @ref.inherit))
(extends_type_clause (type_identifier) @ref.inherit)
`;

const JS_ONLY = `
(field_definition property: (property_identifier) @name) @def.property
(class_heritage (identifier) @ref.inherit)
`;

const PYTHON = `
(class_definition name: (identifier) @name) @def.class
(function_definition name: (identifier) @name) @def.function
(module (expression_statement (assignment left: (identifier) @name)) @def.constant)

(call function: (identifier) @ref.call)
(call function: (attribute attribute: (identifier) @ref.call))
(class_definition superclasses: (argument_list (identifier) @ref.inherit))
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @ref.inherit)))
(type (identifier) @ref.type)

(import_statement name: (dotted_name) @import)
(import_statement name: (aliased_import name: (dotted_name) @import))
(import_from_statement module_name: (_) @import)
`;

const JAVA = `
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(enum_declaration name: (identifier) @name) @def.enum
(annotation_type_declaration name: (identifier) @name) @def.interface
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.constructor
(field_declaration declarator: (variable_declarator name: (identifier) @name)) @def.field
(constant_declaration declarator: (variable_declarator name: (identifier) @name)) @def.constant

(method_invocation name: (identifier) @ref.call)
(object_creation_expression type: (type_identifier) @ref.new)
(superclass (type_identifier) @ref.inherit)
(super_interfaces (type_list (type_identifier) @ref.inherit))
(extends_interfaces (type_list (type_identifier) @ref.inherit))
(field_declaration type: (type_identifier) @ref.type)
(formal_parameter type: (type_identifier) @ref.type)
(local_variable_declaration type: (type_identifier) @ref.type)

(import_declaration (scoped_identifier) @import)
`;

const GO = `
(function_declaration name: (identifier) @name) @def.function
(method_declaration name: (field_identifier) @name) @def.method
(type_spec name: (type_identifier) @name type: (struct_type)) @def.struct
(type_spec name: (type_identifier) @name type: (interface_type)) @def.interface
(type_spec name: (type_identifier) @name type: [(type_identifier) (qualified_type) (map_type) (slice_type) (function_type) (pointer_type) (array_type) (channel_type)]) @def.type
(method_spec name: (field_identifier) @name) @def.method
(source_file (const_declaration (const_spec name: (identifier) @name)) @def.constant)

(call_expression function: (identifier) @ref.call)
(call_expression function: (selector_expression field: (field_identifier) @ref.call))
(composite_literal type: (type_identifier) @ref.new)
(parameter_declaration type: (type_identifier) @ref.type)
(parameter_declaration type: (pointer_type (type_identifier) @ref.type))
(field_declaration type: (type_identifier) @ref.type)

(import_spec path: (interpreted_string_literal) @import)
`;

const C_COMMON = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def.function
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @def.function
(declaration declarator: (function_declarator declarator: (identifier) @name)) @def.function
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.struct
(enum_specifier name: (type_identifier) @name body: (enumerator_list)) @def.enum
(type_definition declarator: (type_identifier) @name) @def.type
(preproc_def name: (identifier) @name) @def.constant
(preproc_function_def name: (identifier) @name) @def.function

(call_expression function: (identifier) @ref.call)
(call_expression function: (field_expression field: (field_identifier) @ref.call))
(parameter_declaration type: (type_identifier) @ref.type)

(preproc_include path: [(string_literal) (system_lib_string)] @import)
`;

const CPP_ONLY = `
(class_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.class
(namespace_definition name: (_) @name) @def.namespace
(function_definition declarator: (function_declarator declarator: (field_identifier) @name)) @def.method
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @def.method
(field_declaration declarator: (function_declarator declarator: (field_identifier) @name)) @def.method

(call_expression function: (qualified_identifier name: (identifier) @ref.call))
(new_expression type: (type_identifier) @ref.new)
(base_class_clause (type_identifier) @ref.inherit)
`;

const CSHARP = `
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(struct_declaration name: (identifier) @name) @def.struct
(enum_declaration name: (identifier) @name) @def.enum
(record_declaration name: (identifier) @name) @def.class
(namespace_declaration name: (_) @name) @def.namespace
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.constructor
(property_declaration name: (identifier) @name) @def.property

(invocation_expression function: (identifier) @ref.call)
(invocation_expression function: (member_access_expression name: (identifier) @ref.call))
(object_creation_expression type: (identifier) @ref.new)
(base_list (identifier) @ref.inherit)
(parameter type: (identifier) @ref.type)

(using_directive (qualified_name) @import)
(using_directive (identifier) @import)
`;

export const TAGS_QUERIES: Record<LanguageId, string> = {
  typescript: TS_COMMON + TS_TYPES,
  tsx: TS_COMMON + TS_TYPES,
  javascript: TS_COMMON + JS_ONLY,
  python: PYTHON,
  java: JAVA,
  go: GO,
  c: C_COMMON,
  cpp: C_COMMON + CPP_ONLY,
  csharp: CSHARP,
};
