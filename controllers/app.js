var app = angular.module('app', ['ngAnimate', 'ui.bootstrap', 'ngStorage', 'chart.js', 'ui.sortable', 'firebase', 'ngRoute']);

app.config(function ($routeProvider, $locationProvider) {
    $locationProvider.html5Mode(false).hashPrefix('');
    $routeProvider
        .when("/:key", {
            templateUrl: 'index.html'
        })
        .when("/", {
            templateUrl: 'index.html'
        });

    // $routeProvider.html5Mode(true);
});

function hslToRgb(h, s, l) {
    var r, g, b;

    if (s === 0) {
        r = g = b = l; // achromatic
    }
    else {
        var hue2rgb = function hue2rgb(p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

app.service('FirebaseService', function ($firebaseObject) {
    var config = {
        apiKey: "AIzaSyCxoOU5GwujNjSmXEk4SEpp6ro92fZ9-6A",
        authDomain: "dc-motor-sim.firebaseapp.com",
        databaseURL: "https://dc-motor-sim.firebaseio.com",
        projectId: "dc-motor-sim",
        storageBucket: "dc-motor-sim.appspot.com",
        messagingSenderId: "727873687029"
    };
    var initialized = false;
    var db = undefined;

    function initializeFirebase() {
        firebase.initializeApp(config);
        db = $firebaseObject(firebase.database().ref());
        initialized = true;
    }

    function getModelSet(key) {
        if (!initialized) initializeFirebase();
        return firebase.database().ref('models/' + key).once('value');
    }

    function addModelSet(models, visible_models, visible_elements) {
        if (!initialized) initializeFirebase();
        var key = firebase.database().ref().child('models').push().key;
        var updates = {};
        updates['/models/' + key] = JSON.stringify({
            models: models,
            visible_models: visible_models,
            visible_elements: visible_elements,
            created: Date.now()
        });
        return firebase.database().ref().update(updates) ? key : undefined;
    }

    return {
        getModelSet: getModelSet,
        addModelSet: addModelSet
    }
});

app.controller('ApplicationController', function ($scope, $localStorage, $sessionStorage, $location, FirebaseService) {
    $scope.model_types = MODEL_TYPES;
    $scope.motors = MOTORS;

    $scope.models = $sessionStorage.models || [];
    $scope.models_expanded = $sessionStorage.models_expanded || {};
    $scope.scale_factors = $sessionStorage.scale_factors || DATA_SCALE_FACTORS;
    $scope.visible_models = $sessionStorage.visible_models || {};
    $scope.visible_elements = $sessionStorage.visible_elements || {};
    $scope.settings_categories = SETTINGS_CATEGORIES;
    $scope.temp_model = undefined;
    $scope.temp_model_type = undefined;
    $scope.temp_model_inputs = undefined;
    $scope.settings_collapsed = [
        {'basic': false},
        {'power': true},
        {'advanced': true},
        {'battery': true},
        {'simulation': true}
    ];
    var next_model_id = 0;
    $scope.models.forEach(function (elem) {
        if (elem.id >= next_model_id) next_model_id = elem.id + 1;
    });

    var session_key = $location.path().substr(1);
    if (session_key.length > 0) {
        $scope.data_loading = 1;
        $scope.models = [];
        FirebaseService.getModelSet(session_key)
            .then(function (snapshot) {
                snapshot = JSON.parse(snapshot.val());
                if (snapshot === null) {
                    $location.path('/');
                    $scope.data_loading -= 1;
                    return;
                }
                $scope.models = snapshot['models'];
                $scope.visible_models = snapshot['visible_models'];
                $scope.visible_elements = snapshot['visible_elements'];
                next_model_id = 0;
                $scope.models.forEach(function (elem) {
                    if(elem.id >= next_model_id) next_model_id = elem.id + 1;
                });
                $scope.data_loading = 0;
                $scope.runSim();
            });
    }

    $scope.$watch('models', function () {
        $sessionStorage.models = $scope.models;
    });
    $scope.$watch('models_expanded', function () {
        $sessionStorage.models_expanded = $scope.models_expanded;
    });
    $scope.$watch('visible_models', function () {
        $sessionStorage.visible_models = $scope.visible_models;
    });
    $scope.$watch('visible_elements', function () {
        $sessionStorage.visible_elements = $scope.visible_elements;
    });
    $scope.$watch('scale_factors', function () {
        $sessionStorage.scale_factors = $scope.scale_factors;
    });

    $scope.$watch(
        function () {
            return angular.toJson($sessionStorage);
        },
        function () {
            $scope.models = $sessionStorage.models;
            $scope.models_expanded = $sessionStorage.models_expanded;
            $scope.visible_models = $sessionStorage.visible_models;
            $scope.visible_elements = $sessionStorage.visible_elements;
            $scope.scale_factors = $sessionStorage.scale_factors;
        });

    function getMotors(motor_type, num_motors) {
        var motors = angular.copy(motor_type);
        motors.free_speed = motors.free_rpm * 2 * Math.PI / 60;  // convert RPM to rad/sec
        motors.k_r = motors.max_voltage / motors.stall_current;
        motors.k_v = motors.free_speed / (motors.max_voltage - motors.k_r * motors.free_current);
        motors.k_t = num_motors * motors.stall_torque / motors.stall_current;
        motors.num_motors = num_motors;
        return motors;
    }

    $scope.shareModels = function () {
        if ($scope.models.length < 1) return;
        var key = FirebaseService.addModelSet($scope.models, $scope.visible_models, $scope.visible_elements);
        if (key !== undefined) $location.path('/' + key);
    };

    $scope.addModel = function (model_type) {
        $scope.model_input_errors = [];
        $scope.temp_model = angular.copy(model_type.model);
        $scope.temp_model_type = model_type;
        $scope.temp_model_inputs = getModelInputs(model_type);
        $scope.temp_model_index = undefined;
    };

    $scope.deleteModel = function (model) {
        $scope.models.splice($scope.models.indexOf(model), 1);
        delete $scope.models_expanded[model.id];
        delete $scope.visible_models[model.id];
        $scope.runSim();
    };

    $scope.editModel = function (model) {
        $scope.model_input_errors = [];
        $scope.temp_model_index = $scope.models.indexOf(model);
        $scope.temp_model = angular.copy(model);
        $scope.temp_model.motor_type = JSON.stringify($scope.temp_model.real_motor_type);
        $scope.temp_model_type = model.model_type;
        $scope.temp_model_inputs = getModelInputs(model.model_type);
    };

    $scope.duplicateModel = function (model) {
        var copied_model = angular.copy(model);
        copied_model.id = undefined;
        $scope.editModel(copied_model);
        $scope.temp_model_index = undefined;
    };

    $scope.submitModel = function () {
        $scope.model_input_errors = [];
        var model = angular.copy($scope.temp_model);
        model.model_type = $scope.temp_model_type;

        for (var key in model) { //Load default parameters in case the user erased them.
            if (model[key] === undefined || model[key] === "" || model[key] === null) {
                model[key] = $scope.temp_model_type.model[key];
            }
        }

        if (model.name === undefined || model.name === null || model.name === "") {
            $scope.model_input_errors.push('name');
        }

        if (model.motor_type === undefined || model.motor_type === null || model.motor_type === "") {
            $scope.model_input_errors.push('motor_type');
        }
        else {
            model.motor_type = JSON.parse(model.motor_type);
            model.motors = getMotors(model.motor_type, model.num_motors);
            model.real_motor_type = model.motor_type;
            model.motor_type = model.motor_type.name;
        }

        if ($scope.model_input_errors.length === 0) {
            model.inputs = getModelInputs(model.model_type);
            if (model.id === undefined || model.id == null) {
                model.id = next_model_id++;
                $scope.models_expanded[model.id] = false;
            }

            if ($scope.visible_models[model.id] === undefined || $scope.visible_models[model.id] === null) {
                $scope.visible_models[model.id] = ($scope.models.length < 5);
            }

            if ($scope.temp_model_index !== undefined) {
                $scope.models[$scope.temp_model_index] = model;
            }
            else {
                $scope.models.push(model);
            }
            $scope.cancelModel();
        }
        $scope.runSim();
    };

    $scope.cancelModel = function () {
        $scope.temp_model = undefined;
        $scope.temp_model_type = undefined;
        $scope.temp_model_inputs = undefined;
        $scope.temp_model_index = undefined;
    };

    $scope.runSim = function () {
        simulator_data = {};
        simulators = {};
        $scope.series = [];
        $scope.data = [];
        $scope.models.forEach(function (model) {
            var sim = new Simulator(model.motors,
                model.gear_ratio,
                model.motor_current_limit,
                model.motor_peak_current_limit,
                model.motor_voltage_limit,
                model.effective_diameter,
                model.effective_mass,
                model.k_gearbox_efficiency,
                model.incline_angle,
                model.check_for_slip,
                model.coeff_kinetic_friction,
                model.coeff_static_friction,
                model.k_resistance_s,
                model.k_resistance_v,
                model.battery_voltage,
                model.resistance_com,
                model.resistance_idv,
                model.time_step,
                model.simulation_time,
                model.max_dist);
            simulators[model.id] = sim;
            var data = {};
            $scope.elements_can_plot.forEach(function (elem) {
                data[elem] = [];
            });
            sim.getDataPoints().forEach(function (pt) {
                for (var k in data) {
                    data[k].push({
                        x: pt.time,
                        y: pt[k]
                    });
                }
            });
            simulator_data[model.id] = data;
        });
        $scope.loadLines();
    };

    $scope.loadLines = function () {
        $scope.data = [];
        $scope.datasetOverride = [];

        $scope.line_colours = [];
        for (var i = 0; i < $scope.models.length; i++) {
            var hue = (i / $scope.models.length);
            var saturation = 0.5;
            var luminance = 0.5;
            var rgb = hslToRgb(hue, saturation, luminance);
            $scope.line_colours.push("rgb(" + rgb.join(', ') + ")");
        }

        $scope.line_types = [[20, 5], [100000, 1], [10, 2]];
        for (var i = $scope.line_types.length; i < $scope.elements_can_plot.length; i++) {
            $scope.line_types.push($scope.line_types[$scope.line_types.length - 1].concat([2, 3]));
        }

        $scope.models.forEach(function (model) {
            if ($scope.visible_models[model.id]) {
                $scope.elements_can_plot.forEach(function (key) {
                    if ($scope.visible_elements[key]) {
                        var data = [];
                        simulator_data[model.id][key].forEach(function (pnt) {
                            pnt = angular.copy(pnt);
                            pnt.y = pnt.y / $scope.scale_factors[key];
                            data.push(pnt);
                        });
                        $scope.data.push(data);
                        $scope.datasetOverride.push({
                            pointRadius: 0,
                            fill: false,
                            borderColor: $scope.line_colours[$scope.models.indexOf(model)],
                            borderDash: $scope.line_types[$scope.elements_can_plot.indexOf(key)]
                        });
                    }
                });
            }
        });
    };

    $scope.onClick = function (points, evt) {
        console.log(points, evt);
    };

    var simulators = {};
    var simulator_data = {};
    $scope.elements_can_plot = Object.keys(DATA_HEADERS);
    $scope.element_titles = DATA_HEADERS;
    $scope.series = [];
    $scope.data = [];
    $scope.datasetOverride = [];
    $scope.options = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            yAxes: [{
                ticks: {
                    beginAtZero: true
                }
            }],
            xAxes: [{
                type: 'linear',
                ticks: {
                    min: 0,
                    stepSize: 0.01
                }
            }]
        }
    };

    $scope.runSim();
});
