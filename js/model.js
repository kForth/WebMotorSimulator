var MODEL_TYPES = [
    {
        name: 'Drivetrain',
        distance_unit: 'm',
        model: {
            motor_type: "",
            num_motors: 4,
            gear_ratio: 10,
            effective_diameter: 0.15,
            effective_mass: 65,
            motor_current_limit: null,
            motor_peak_current_limit: null,
            motor_voltage_limit: null,
            k_gearbox_efficiency: 0.7,
            coeff_kinetic_friction: 0.8,
            coeff_static_friction: 1.0,
            incline_angle: 0,
            k_resistance_s: 0,
            k_resistance_v: 0,
            battery_voltage: 12.5,
            resistance_com: 0.013,
            resistance_idv: 0.002,
            time_step: 0.01,
            simulation_time: 10.0,
            max_dist: 8
        }
    },
    {
        name: 'Elevator',
        distance_unit: 'm',
        model: {
            motor_type: "",
            num_motors: 2,
            gear_ratio: 10,
            effective_diameter: 2 * 0.0254,
            effective_mass: 10,
            motor_current_limit: null,
            motor_peak_current_limit: null,
            motor_voltage_limit: null,
            k_gearbox_efficiency: 0.7,
            coeff_kinetic_friction: 0.8,
            coeff_static_friction: 1.0,
            incline_angle: 0,
            k_resistance_s: 0,
            k_resistance_v: 0,
            battery_voltage: 12.5,
            resistance_com: 0.013,
            resistance_idv: 0.002,
            time_step: 0.01,
            simulation_time: 10.0,
            max_dist: 8
        }
    },
    {
        name: 'Arm',
        distance_unit: 'rad',
        model: {
            motor_type: "",
            num_motors: 2,
            gear_ratio: 10,
            effective_diameter: 1,
            effective_mass: 10,
            motor_current_limit: null,
            motor_peak_current_limit: null,
            motor_voltage_limit: null,
            k_gearbox_efficiency: 0.7,
            coeff_kinetic_friction: 0.8,
            coeff_static_friction: 1.0,
            incline_angle: 0,
            k_resistance_s: 0,
            k_resistance_v: 0,
            battery_voltage: 12.5,
            resistance_com: 0.013,
            resistance_idv: 0.002,
            time_step: 0.01,
            simulation_time: 10.0,
            max_dist: 8
        }
    }
];

var MODEL_INPUTS = {
    'Drivetrain': [
        {
            label: 'Name',
            key: 'name',
            type: 'text',
            required: true,
            unique: true,
            order: 11
        },
        {
            label: 'Motor Type',
            key: 'motor_type',
            type: 'motor_type',
            required: true,
            unique: false,
            order: 12
        },
        {
            label: 'Num Motors',
            key: 'num_motors',
            type: 'number',
            required: true,
            unique: false,
            order: 22
        },
        {
            label: 'Gear Ratio',
            key: 'gear_ratio',
            type: 'number',
            suffix: ':1',
            required: true,
            unique: false,
            order: 21
        },
        {
            label: 'Wheel Diameter',
            key: 'effective_diameter',
            type: 'number',
            suffix: 'm',
            required: true,
            unique: false,
            order: 31
        },
        {
            label: 'Wheel Coeff Static Friction',
            key: 'coeff_static_friction',
            type: 'number',
            required: true,
            unique: false,
            order: 32
        },
        {
            label: 'Robot Mass',
            key: 'effective_mass',
            type: 'number',
            suffix: 'kg',
            required: true,
            unique: false,
            order: 41
        }
    ],
    'Elevator': [
        {
            label: 'Name',
            key: 'name',
            type: 'text',
            required: true,
            unique: true,
            order: 11
        },
        {
            label: 'Motor Type',
            key: 'motor_type',
            type: 'motor_type',
            required: true,
            unique: false,
            order: 12
        },
        {
            label: 'Num Motors',
            key: 'num_motors',
            type: 'number',
            required: true,
            unique: false,
            order: 22
        },
        {
            label: 'Gear Ratio',
            key: 'gear_ratio',
            type: 'number',
            suffix: ':1',
            required: true,
            unique: false,
            order: 21
        },
        {
            label: 'Pulley Diameter',
            key: 'effective_diameter',
            type: 'number',
            suffix: 'm',
            required: true,
            unique: false,
            order: 31
        },
        {
            label: 'Mass',
            key: 'effective_mass',
            type: 'number',
            suffix: 'kg',
            required: true,
            unique: false,
            order: 41
        }
    ],
    'Arm': [
        {
            label: 'Name',
            key: 'name',
            type: 'text',
            required: true,
            unique: true,
            order: 11
        },
        {
            label: 'Motor Type',
            key: 'motor_type',
            type: 'motor_type',
            required: true,
            unique: false,
            order: 12
        },
        {
            label: 'Num Motors',
            key: 'num_motors',
            type: 'number',
            required: true,
            unique: false,
            order: 22
        },
        {
            label: 'Gear Ratio',
            key: 'gear_ratio',
            type: 'number',
            suffix: ':1',
            required: true,
            unique: false,
            order: 21
        },
        {
            label: 'CG Distance * 2',
            key: 'effective_diameter',
            type: 'number',
            suffix: 'm',
            required: true,
            unique: false,
            order: 31
        },
        {
            label: 'Arm Mass',
            key: 'effective_mass',
            type: 'number',
            suffix: 'kg',
            required: true,
            unique: false,
            order: 41
        }
    ]
};

function getModelInputs(model_type) {
    var inputs = {
        'power': [
            {
                label: 'Current Limit',
                key: 'current_limit',
                type: 'number',
                suffix: 'A',
                required: false,
                unique: false,
                order: 11
            },
            {
                label: 'Peak Current Limit',
                key: 'peak_current_limit',
                type: 'number',
                suffix: 'A',
                required: false,
                unique: false,
                order: 21
            },
            {
                label: 'Voltage Limit',
                key: 'voltage_limit',
                type: 'number',
                suffix: 'V',
                required: false,
                unique: false,
                order: 12
            },
            {
                label: 'Gearbox Efficiency',
                key: 'k_efficiency',
                type: 'number',
                suffix: '%',
                required: false,
                unique: false,
                order: 22
            }
        ],
        'advanced': [
            {
                label: 'Static Resistance',
                key: 'k_resistance_s',
                type: 'number',
                suffix: 'N',
                required: false,
                unique: false,
                order: 11
            },
            {
                label: 'Viscous Resistance',
                key: 'k_resistance_v',
                type: 'number',
                suffix: 'N/' + 'm' + '/s',
                required: false,
                unique: false,
                order: 21
            },
            {
                label: 'Coefficient of Kinetic Friction',
                key: 'coeff_kinetic_friction',
                type: 'number',
                required: false,
                unique: false,
                order: 12
            },
            {
                label: 'Coefficient of Static Friction',
                key: 'coeff_static_friction',
                type: 'number',
                required: false,
                unique: false,
                order: 22
            },
            {
                label: 'Incline Angle',
                key: 'incline_angle',
                type: 'number',
                suffix: 'deg',
                required: false,
                unique: false,
                order: 31
            }
        ],
        'battery': [
            {
                label: 'Battery Voltage',
                key: 'battery_voltage',
                type: 'number',
                suffix: 'V',
                required: false,
                unique: false,
                order: 11
            },
            {
                label: 'Common Resistance',
                key: 'resistance_com',
                type: 'number',
                suffix: 'Ω',
                tooltip: 'The resistance from the battery to the PDP, including connectors and main breaker.',
                required: false,
                unique: false,
                order: 12
            },
            {
                label: 'Individual Resistance',
                key: 'resistance_idv',
                type: 'number',
                suffix: 'Ω',
                tooltip: 'The resistance from the PDP to a motor, including breaker and speed controller.',
                required: false,
                unique: false,
                order: 21
            }
        ],
        'simulation': [
            {
                label: 'Max Time',
                key: 'simulation_time',
                type: 'number',
                suffix: 's',
                required: false,
                unique: false,
                order: 11
            },
            {
                label: 'Max Dist',
                key: 'max_dist',
                type: 'number',
                suffix: 'm',
                required: false,
                unique: false,
                order: 12
            },
            {
                label: 'Time Step',
                key: 'time_step',
                type: 'number',
                suffix: 's',
                required: false,
                unique: false,
                order: 21
            },
            {
                label: 'Initial Position',
                key: 'initial_position',
                type: 'number',
                suffix: 'm',
                required: false,
                unique: false,
                order: 22
            },
            {
                label: 'Initial Velocity',
                key: 'initial_velocity',
                type: 'number',
                suffix: 'm' + '/s',
                required: false,
                unique: false,
                order: 31
            },
            {
                label: 'Intial Acceleration',
                key: 'initial_acceleration',
                type: 'number',
                suffix: 'm' + '/s/s',
                required: false,
                unique: false,
                order: 32
            }

        ],
        'basic': []
    };
    inputs.basic = MODEL_INPUTS[model_type.name];
    return inputs;
}

var SETTINGS_CATEGORIES = [
    {
        text: 'Basic Settings',
        key: 'basic'
    },
    {
        text: 'Power Settings',
        key: 'power'
    },
    {
        text: 'Advanced Settings',
        key: 'advanced'
    },
    {
        text: 'Battery Settings',
        key: 'battery'
    },
    {
        text: 'Simulation Settings',
        key: 'simulation'
    }
];